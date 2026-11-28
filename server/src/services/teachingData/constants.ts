import type { Campus } from './types.js';

export const SSO_BASE = 'https://login.xiaojiaoyu100.com';
export const TEACHING_BASE = 'https://teaching.xiaojiaoyu100.com';
export const ALLOWED_HOSTS = new Set(['login.xiaojiaoyu100.com', 'teaching.xiaojiaoyu100.com']);

export const SSO_SIGNIN = SSO_BASE + '/v2/user/signin';
export const SSO_2STEP_SEND = {
  sms: SSO_BASE + '/v2/oauth2/2step/sms',
  wx: SSO_BASE + '/v2/oauth2/2step/wxMs',
} as const;
export const SSO_2STEP_VERIFY = {
  sms: SSO_BASE + '/v2/oauth2/2step',
  wx: SSO_BASE + '/v2/oauth2/2step/wxMsOAuth',
} as const;
export const TEACHING_CALLBACK = TEACHING_BASE + '/tea_api/v1/oauth2/callback';

export const URL_CONFIG = {
  feedback: TEACHING_BASE + '/tea_api/v1/mon/feedback/detail',
  tutorplan: TEACHING_BASE + '/tea_api/v1/mon/tutorplan/detail',
  evaluate_analysis: TEACHING_BASE + '/tea_api/v1/mon/evaluateanalysis/detail',
  prepare: TEACHING_BASE + '/tea_api/management/statistics/v2/1v1/prepare-leasons/details',
} as const;

export const DEPARTMENTS = {
  math: { name: '数学组', id: 'DAT0000000436' },
  science: { name: '理综组', id: 'DAT0000000440' },
  arts: { name: '文科组', id: 'DAT0000000443' },
} as const;

export const DEFAULT_CAMPUS: Campus = {
  branchId: process.env.BRANCH_ID || 'ff808081482d0c3801482d2a301a0003',
  branchName: process.env.BRANCH_NAME || '中山分公司',
  campusId: process.env.CAMPUS_ID || 'ORG0000000706',
  campusName: process.env.CAMPUS_NAME || '小榄龙山学习中心',
};

export const PAGE_SIZE = 50;
export const MAX_PAGES = 200;
export const MAX_WORKERS = 3;
export const RETRY_TIMES = 3;
export const RETRY_BACKOFF_MS = 500;
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 6;
export const TWO_STEP_TTL_MS = 10 * 60_000;
export const TWO_STEP_MAX = 50;
export const FETCH_TTL_MS = 30 * 60_000;
export const FETCH_MAX = 20;

// 与源项目前端 bundle 使用同一把 PKCS#1 RSA 公钥；私钥仅由 SSO 持有。
export const SSO_RSA_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwgYdR3wRh2U4cZ1wSO/p
aFGK/YvZIJL629GC6QG5UqiohU3ecMb04eJ7a3FeszVv+q0FXoVZgBhpSMGzwXsW
kwU8swM3SZ0MZdo40EiPgKvEguqB93KvHyNZm3LFFvQkLmFFSYrJFYJZo5aHadz2
l5XkIMjcd2SAeEQH1zOnpQe18saYFopCt4GGbKdKu82fdPxfolFXZrxThwGAe4xT
ZwGPJIlmG73pxot04ENhUctQY/uz7GbrsTpZ5KwqimvCuNxsJGSSOhaZ/UCoQjZ9
PtKiU8+UfkwECJctcAkagG2LXMcDMMo0/HrEVDbv0hmO5uNBow4RI+efzAZvJ4qS
OQIDAQAB
-----END RSA PUBLIC KEY-----`;

export const COLUMN_LABELS: Record<string, string> = {
  科组: '科组', 统计口径: '统计口径', branchName: '分公司', campusName: '学习中心',
  departmentName: '科组（平台）', teacherName: '教师姓名', teacherNo: '教师工号',
  subjectName: '科目', gradeName: '年级', className: '班级', studentName: '学生姓名',
  studentNo: '学生学号', courseDate: '上课日期', courseTime: '上课时间',
  courseTagName: '课程标签', courseTypeName: '课程类型', stateName: '状态',
  studentCount: '学生人数', courseNum: '课次量', newStuCourseNum: '新学生课次量',
  mustUploadNum: '应上传', uploadNum: '已上传', notOnTimeUploadNum: '未按时上传',
  notUploadNum: '未上传', uploadRate: '完成率', totalMustUploadNum: '应阶测科次',
  totalUploadNum: '按时完成科次', totalNotOnTimeUploadNum: '未按时完成科次',
  totalNotUploadNum: '待完成科次', evaluateRate: '覆盖率', tutorRate: '完成率',
  planNum: '计划数', finishNum: '完成数', createTime: '创建时间', updateTime: '更新时间', remark: '备注',
};

export const COLUMN_ORDER = [
  '科组', '统计口径', '分公司', '学习中心', '教师姓名', '教师工号', '科目', '年级', '班级',
  '学生姓名', '学生学号', '上课日期', '上课时间', '课程标签', '课程类型', '状态', '学生人数',
  '课次量', '新学生课次量', '应上传', '已上传', '未按时上传', '未上传', '完成率',
  '应阶测科次', '按时完成科次', '未按时完成科次', '待完成科次', '覆盖率',
  '计划数', '完成数', '创建时间', '更新时间', '备注',
];

export const PREVIEW_MAPPING: Record<string, string> = {
  科组: '所属组', teacherName: '教师', courseDate: '日期', studentName: '学生',
  stateName: '状态', courseTagName: '课程标签', 统计口径: '统计口径',
};
