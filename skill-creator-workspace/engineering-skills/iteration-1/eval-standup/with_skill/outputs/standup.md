## Standup — Friday, March 28

**Yesterday**
- Debugged and resolved production outage — API returning 502s due to nginx passing wrong Connection header to Fastify, breaking the keepalive pool. Fixed with sed on nginx config and docker exec reload.
- Reviewed PR for rate limiting implementation.

**Today**
- Integrate Stripe for Pro tier subscription support.
- Finish Pinecone semantic search task.

**Blockers**
- None
