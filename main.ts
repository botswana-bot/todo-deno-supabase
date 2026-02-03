// Deno Deploy entrypoint: static hosting for the Supabase Todo app.
//
// Deploy on Deno Deploy as-is.
// Local dev (if you install Deno):
//   deno task start

import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

Deno.serve((req) => {
  const url = new URL(req.url);

  // Health
  if (url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  // Static assets
  return serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: false,
    enableCors: false,
  });
});
