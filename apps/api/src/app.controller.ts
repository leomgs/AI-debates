import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './shared/http/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // ADR 0001 punto 1: GET / es uno de los pocos endpoints sin sesión.
  @Public()
  @Get()
  @ApiOperation({ operationId: 'getHello' })
  getHello(): string {
    return this.appService.getHello();
  }
}
