import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ItemsModule } from '../items/items.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [AccountsModule, ItemsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
