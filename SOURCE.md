# Pulse External Data Sources and Attribution

Pulse makes outbound requests only to public endpoints and status APIs for portfolio demonstration.

## User-Agent

All outbound HTTP requests should use:

Pulse-Monitor/0.1 (+https://github.com/you/pulse; contact@example.com)

## Stream A Probe Targets

- GitHub API: https://api.github.com/zen
- GitHub Status API: https://www.githubstatus.com/api/v2/status.json
- OpenAI API: https://api.openai.com/v1/models
- Stripe API: https://api.stripe.com/v1/charges
- Cloudflare API: https://api.cloudflare.com/client/v4/user
- Httpbin: https://httpbin.org/status/200
- Httpbin delay: https://httpbin.org/delay/2
- JSONPlaceholder: https://jsonplaceholder.typicode.com/posts/1
- npm registry: https://registry.npmjs.org/-/ping
- PyPI simple index: https://pypi.org/simple/
- Docker Hub API: https://hub.docker.com/v2/repositories/library/nginx/
- Google DNS TCP endpoint: 8.8.8.8:53
- Cloudflare DNS TCP endpoint: 1.1.1.1:53
- GitHub DNS lookup target: github.com
- Stripe synthetic flow targets:
  - https://api.stripe.com/v1/charges
  - https://js.stripe.com/v3/
  - https://checkout.stripe.com/

## Stream B Statuspage Hosts

- https://www.githubstatus.com
- https://status.openai.com
- https://status.stripe.com
- https://www.cloudflarestatus.com
- https://discordstatus.com
- https://status.slack.com
- https://status.atlassian.com
- https://www.redditstatus.com
- https://status.twilio.com
- https://status.digitalocean.com
- https://status.zoom.us
- https://status.sendgrid.com
- https://status.npmjs.org
- https://status.python.org
- https://status.docker.com

## Usage Note

All data is consumed from public APIs and public status pages for portfolio demonstration only, under each provider's published API and status-page terms.
