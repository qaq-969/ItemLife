import type {
  DashboardBreakdownDto,
  DashboardGranularity,
  DashboardOverviewDto,
  DashboardTrendDto,
} from '@itemlife/shared';
import { http, unwrap } from './http';

export interface DashboardQuery {
  domain?: string;
  from?: string;
  to?: string;
  accountId?: string;
  granularity?: DashboardGranularity;
}

export const dashboardApi = {
  overview: (params: DashboardQuery = {}) => unwrap<DashboardOverviewDto>(http.get('/dashboard/overview', { params })),
  trend: (params: DashboardQuery = {}) => unwrap<DashboardTrendDto>(http.get('/dashboard/trend', { params })),
  breakdown: (params: DashboardQuery = {}) => unwrap<DashboardBreakdownDto>(http.get('/dashboard/breakdown', { params })),
};
