import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class InterestPreviewQueryDto {
  @ApiPropertyOptional({ description: '数据域：user（默认）或 household:<id>' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({ description: '只预估某个账户；省略则返回该数据域内全部计息账户' })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class InterestPostDto {
  @ApiProperty({ description: '要结息的账户 ID' })
  @IsUUID()
  accountId!: string;
}
