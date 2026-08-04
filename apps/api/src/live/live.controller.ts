import { Controller, Sse } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { map, Observable } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import { LiveService } from "./live.service";

@ApiTags("live")
@Controller("live")
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @Sse("probes")
  @ApiOperation({ summary: "Live probe stream over SSE" })
  @ApiResponse({ status: 200, description: "SSE stream established" })
  streamProbes(): Observable<MessageEvent> {
    return this.liveService.stream().pipe(
      map((data) => ({
        data
      }))
    );
  }
}
