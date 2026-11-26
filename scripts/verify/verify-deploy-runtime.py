#!/usr/bin/env python3
"""Exercise deploy.sh control flow with isolated Docker/curl stubs (no real Docker)."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy.sh"

DOCKER_STUB = r'''#!/bin/bash
set -u
{
  printf 'docker'
  printf ' <%s>' "$@"
  printf '\n'
} >> "$STUB_LOG"

if [ "$1" = "compose" ]; then
  shift
  if [ "$1" = "-f" ]; then shift 2; fi
  command="$1"
  shift || true
  case "$command" in
    pull | up)
      effective_tag="${TAG:-}"
      if [ -z "$effective_tag" ] && [ -f .env ]; then
        effective_tag=$(grep -E '^TAG=' .env | tail -1 | cut -d= -f2- || true)
      fi
      printf 'compose_%s_tag=%s\n' "$command" "$effective_tag" >> "$STUB_LOG"
      ;;
    port)
      # Deliberately independent of .env quoting: this is the actual Compose mapping.
      echo '0.0.0.0:10880'
      ;;
    exec)
      args="$*"
      case "$args" in
        *'backend printenv BUILD_SHA'*) exit 1 ;;
        *'frontend nginx -t'*) exit 0 ;;
        *'frontend netstat -lnt'*)
          count=$(cat "$STUB_COUNT" 2>/dev/null || echo 0)
          count=$((count + 1))
          echo "$count" > "$STUB_COUNT"
          if [ "$count" -ge "$READY_AT" ]; then
            echo 'tcp 0 0 0.0.0.0:80 0.0.0.0:* LISTEN'
            exit 0
          fi
          exit 1
          ;;
        *'frontend wget'*) exit 0 ;;
      esac
      ;;
    ps)
      if [ "${1:-}" = "-q" ]; then echo 'stub-container'; else echo 'stub frontend running'; fi
      ;;
    logs)
      echo 'stub frontend logs'
      ;;
  esac
  exit 0
fi

case "${1:-}" in
  volume) exit 1 ;;
  inspect) echo 'stub container diagnostic'; exit 0 ;;
  *) exit 0 ;;
esac
'''

CURL_STUB = r'''#!/bin/bash
printf 'curl <%s>\n' "$*" >> "$STUB_LOG"
exit 0
'''


def run_case(name: str, ready_at: int, rollback: bool = False) -> None:
    with tempfile.TemporaryDirectory(prefix=f"deploy-{name}-") as raw:
        temp = Path(raw)
        bin_dir = temp / "bin"
        bin_dir.mkdir()
        log = temp / "commands.log"
        count = temp / "netstat.count"
        rollback_file = temp / "rollback-tag"
        shutil.copy2(DEPLOY, temp / "deploy.sh")
        (temp / ".env").write_text(
            "JWT_SECRET=test-secret\n"
            "SENSENOVA_API_KEY=test-key\n"
            "DEFAULT_ADMIN_PASS=not-a-default-password\n"
            "TAG=env-sha\n"
            'FRONTEND_PORT="10880"\n',
            encoding="utf-8",
        )
        # DATA_PATH is deliberately absent: grep miss must not abort under pipefail.
        for tool, content in (("docker", DOCKER_STUB), ("curl", CURL_STUB), ("sleep", "#!/bin/bash\nexit 0\n")):
            path = bin_dir / tool
            path.write_text(content, encoding="utf-8")
            path.chmod(0o755)
        args = ["bash", "deploy.sh"]
        if rollback:
            rollback_file.write_text("old-sha\n", encoding="utf-8")
            args.append("--rollback")
        else:
            args.append("--no-backup")
        env = os.environ.copy()
        env.update({
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(temp),
            "ROLLBACK_FILE": str(rollback_file),
            "STUB_LOG": str(log),
            "STUB_COUNT": str(count),
            "READY_AT": str(ready_at),
        })
        env.pop("TAG", None)
        env.pop("DATA_PATH", None)
        result = subprocess.run(args, cwd=temp, env=env, text=True, capture_output=True, timeout=20)
        commands = log.read_text(encoding="utf-8") if log.exists() else ""
        output = result.stdout + result.stderr

        if name == "success":
            assert result.returncode == 0, output
            assert "第 3 次探测" in output, output
            assert "compose_pull_tag=env-sha" in commands, commands
            assert "compose_up_tag=env-sha" in commands, commands
            assert " down " not in commands, commands
            assert (temp / "data" / "uploads").is_dir(), "default DATA_PATH directory missing"
            assert "http://127.0.0.1:10880/healthz" in commands, commands
            assert "http://127.0.0.1:10880/health" in commands, commands
        elif name == "failure":
            assert result.returncode != 0, output
            assert "30 秒内未就绪" in output, output
            assert "stub frontend logs" in output, output
            assert count.read_text(encoding="utf-8").strip() == "16", count.read_text(encoding="utf-8")
        elif name == "rollback":
            assert result.returncode == 0, output
            assert "回滚完成" in output, output
            assert "compose_pull_tag=old-sha" in commands, commands
            assert "compose_up_tag=old-sha" in commands, commands
            assert "第 1 次探测" in output, output
            assert "http://127.0.0.1:10880/healthz" in commands, commands
        print(f"PASS {name}: returncode={result.returncode}, ready_at={ready_at}")


if __name__ == "__main__":
    run_case("success", ready_at=3)
    run_case("failure", ready_at=99)
    run_case("rollback", ready_at=1, rollback=True)
    print("All isolated deployment runtime checks passed.")
