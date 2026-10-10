import { Module } from '@nestjs/common';
import { SiteAdminController } from './site-admin.controller';
import { SiteAdminService } from './site-admin.service';

@Module({ controllers: [SiteAdminController], providers: [SiteAdminService] })
export class SiteAdminModule {}
