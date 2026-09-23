import type { CategoryKind } from './constants';

/** 预置分类树的节点：icon 为前端图标名，color 为主题色（十六进制）。 */
export interface PresetCategory {
  name: string;
  icon: string;
  color: string;
  /** 系统语义标签（仅顶层，驱动「收益」看板口径与自动结息流水归类） */
  systemTag?: string;
  children?: Array<Pick<PresetCategory, 'name' | 'icon' | 'color'>>;
}

/**
 * 预置分类（设计报告 5.2 ⑦）：注册时复制一份到该用户的数据域，之后可自由增删改。
 * 账户结息会按 systemTag='interest' 归类，找不到时会自动补建，故删除也是安全的。
 */
export const PRESET_CATEGORIES: Record<CategoryKind, PresetCategory[]> = {
  expense: [
    {
      name: '餐饮',
      icon: 'utensils',
      color: '#f97316',
      children: [
        { name: '早餐', icon: 'coffee', color: '#fb923c' },
        { name: '午餐', icon: 'utensils', color: '#f97316' },
        { name: '晚餐', icon: 'utensils', color: '#ea580c' },
        { name: '外卖', icon: 'bike', color: '#fdba74' },
        { name: '饮品', icon: 'cup-soda', color: '#f59e0b' },
      ],
    },
    {
      name: '交通',
      icon: 'bus',
      color: '#6366f1',
      children: [
        { name: '公交地铁', icon: 'bus', color: '#818cf8' },
        { name: '打车', icon: 'car-taxi-front', color: '#6366f1' },
        { name: '加油停车', icon: 'fuel', color: '#4f46e5' },
      ],
    },
    {
      name: '居住',
      icon: 'home',
      color: '#14b8a6',
      children: [
        { name: '房租', icon: 'key-round', color: '#14b8a6' },
        { name: '水电燃气', icon: 'zap', color: '#0d9488' },
        { name: '物业', icon: 'building-2', color: '#0f766e' },
      ],
    },
    { name: '日用百货', icon: 'basket', color: '#0ea5e9' },
    { name: '数码家电', icon: 'laptop', color: '#8b5cf6' },
    { name: '医疗健康', icon: 'heart-pulse', color: '#ef4444' },
    { name: '娱乐休闲', icon: 'gamepad-2', color: '#ec4899' },
    { name: '学习教育', icon: 'book-open', color: '#a855f7' },
    { name: '人情往来', icon: 'gift', color: '#f43f5e' },
    { name: '其他', icon: 'ellipsis', color: '#64748b' },
  ],
  income: [
    { name: '工资', icon: 'wallet', color: '#22c55e' },
    { name: '奖金', icon: 'award', color: '#16a34a' },
    { name: '投资收益', icon: 'trending-up', color: '#10b981', systemTag: 'investment_return' },
    { name: '利息收益', icon: 'percent', color: '#059669', systemTag: 'interest' },
    { name: '其他收入', icon: 'coins', color: '#0d9488' },
  ],
};
