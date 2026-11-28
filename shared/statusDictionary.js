"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_HEX = exports.STATUS_COLOR = exports.STATUS_LABEL = exports.STATUS_MAP = void 0;
exports.normalizeStatus = normalizeStatus;
exports.countByStatus = countByStatus;
exports.isPositiveStatus = isPositiveStatus;
exports.isRiskStatus = isRiskStatus;
exports.STATUS_MAP = {
    // 预交/预存/已支付变体
    'prepaid': 'prepaid',
    '预交': 'prepaid',
    '预存': 'prepaid',
    '已预交': 'prepaid',
    'paid': 'prepaid',
    'payed': 'prepaid',
    'deposit': 'prepaid',
    '预付': 'prepaid',
    '已付': 'prepaid',
    // 到期未续/过期变体
    'expired': 'expired',
    '到期未续': 'expired',
    '到期': 'expired',
    '过期': 'expired',
    'overdue': 'expired',
    '未续费': 'expired',
    // 已续费/续科/转化变体
    'renewed': 'renewed',
    '已续费': 'renewed',
    '续科': 'renewed',
    '续费': 'renewed',
    'converted': 'renewed',
    'conversion': 'renewed',
    'renew': 'renewed',
    'success': 'renewed',
    '成交': 'renewed',
    // 流失/退费/放弃变体
    'lost': 'lost',
    '流失': 'lost',
    '退费': 'lost',
    'dropped': 'lost',
    'drop': 'lost',
    '放弃': 'lost',
    'cancelled': 'lost',
    'canceled': 'lost',
    '退学': 'lost',
    '流失生': 'lost',
};
/**
 * 归一化单个状态值。
 * @param raw 原始状态字符串（可能为 null/undefined/空串）
 * @returns 标准状态枚举，默认归为 expired（保守策略：未知视为待续费风险）
 */
function normalizeStatus(raw) {
    if (!raw)
        return 'expired';
    const key = raw.trim();
    return exports.STATUS_MAP[key] ?? 'expired';
}
/**
 * 批量归一化，返回计数映射。
 * 用于 getRateOverview 等聚合统计。
 */
function countByStatus(rawStatuses) {
    const counts = { prepaid: 0, expired: 0, renewed: 0, lost: 0 };
    for (const s of rawStatuses) {
        counts[normalizeStatus(s)]++;
    }
    return counts;
}
/**
 * 判断是否为「正向」状态（预交/已续费）。
 * 用于预警、完成率分子等业务判断。
 */
function isPositiveStatus(status) {
    return status === 'prepaid' || status === 'renewed';
}
/**
 * 判断是否为「风险」状态（到期未续/流失）。
 */
function isRiskStatus(status) {
    return status === 'expired' || status === 'lost';
}
/**
 * 获取状态的语义标签（中文），用于前端展示。
 */
exports.STATUS_LABEL = {
    prepaid: '预交',
    expired: '到期未续',
    renewed: '已续费',
    lost: '流失',
};
/**
 * 获取状态的语义色值（Tailwind 色板），用于前端 Badge/热力图/图表。
 */
exports.STATUS_COLOR = {
    prepaid: 'emerald-500', // #10B981
    expired: 'amber-500', // #F59E0B
    renewed: 'blue-500', // #3B82F6
    lost: 'red-500', // #EF4444
};
/**
 * 获取状态的十六进制色值（给图表库用，如 recharts/d3）。
 */
exports.STATUS_HEX = {
    prepaid: '#10B981',
    expired: '#F59E0B',
    renewed: '#3B82F6',
    lost: '#EF4444',
};
