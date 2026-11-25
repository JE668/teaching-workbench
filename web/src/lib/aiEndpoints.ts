export interface AiEndpointPresentation {
  label: string;
  description: string;
}

/** 后端 endpoint 是统计主键；所有看板统一展示教师能理解的业务名称。 */
const AI_ENDPOINT_PRESENTATIONS: Record<string, AiEndpointPresentation> = {
  followup_stream: { label: '课后回访（逐段生成）', description: '边生成边展示回访内容' },
  followup_once: { label: '课后回访（整篇生成）', description: '生成完成后一次返回完整回访' },
  report_summary_stream: { label: '月报总结（逐段生成）', description: '边生成边展示月度总结' },
  report_summary_once: { label: '月报总结（整篇生成）', description: '生成完成后一次返回月度总结' },
  report_plan_stream: { label: '月报教学计划（逐段生成）', description: '边生成边展示后续教学计划' },
  report_plan_once: { label: '月报教学计划（整篇生成）', description: '生成完成后一次返回后续教学计划' },
  report_summary: { label: '月报总结', description: '生成学生月度学习总结' },
  report_plan: { label: '月报教学计划', description: '生成学生后续教学计划' },
  observation_stream: { label: '听评课报告（逐段生成）', description: '边生成边展示听评课反馈报告' },
  observation_once: { label: '听评课报告（整篇生成）', description: '生成完成后一次返回完整听评课反馈报告' },
  multimodal_observations: { label: '回访图片观察提取', description: '从课后回访图片中提取学生课堂观察' },
  lesson_planner_generate: { label: '教案生成', description: '生成阶段教学教案' },
  exam_analysis: { label: '试卷分析', description: '分析试卷与学生答题情况' },
  knowledge_extraction: { label: '知识点提取', description: '从教学内容中提取知识点' },
  parent_view: { label: '家长反馈生成', description: '生成面向家长的反馈内容' },
  student_profile: { label: '学生学情画像', description: '整理学生学情与成长画像' },
  weekly_digest: { label: '每周教学摘要', description: '汇总每周教学内容' },
};

export function endpointPresentation(endpoint: string): AiEndpointPresentation {
  return AI_ENDPOINT_PRESENTATIONS[endpoint] || {
    label: '其他 AI 教学服务',
    description: '该调用类型暂未配置业务名称',
  };
}
