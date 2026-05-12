import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [JwtModule.register({}), AuthModule],
    providers: [ChatGateway],
    exports: [ChatGateway],
})
export class ChatModule { }
