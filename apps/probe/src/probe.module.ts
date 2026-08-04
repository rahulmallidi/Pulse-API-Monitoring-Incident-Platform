import { Module } from "@nestjs/common";
import { ProbeService } from "./probe.service";
import { HttpExecutor } from "./executors/http.executor";
import { TcpExecutor } from "./executors/tcp.executor";
import { DnsExecutor } from "./executors/dns.executor";
import { SyntheticExecutor } from "./executors/synthetic.executor";

@Module({
  providers: [ProbeService, HttpExecutor, TcpExecutor, DnsExecutor, SyntheticExecutor],
  exports: [ProbeService]
})
export class ProbeModule {}
