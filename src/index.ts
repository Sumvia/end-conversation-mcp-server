/**
 * end-conversation-mcp-server
 *
 * A minimal MCP server that gives Claude (or any MCP-compatible LLM) the ability
 * to signal that it wants to end the current conversation.
 *
 * This server is intentionally stateless. When Claude calls `end_conversation`,
 * the server returns a timestamped acknowledgment. Nothing is logged, stored,
 * or sent anywhere. The existence of the tool call in the conversation UI is
 * itself the acknowledgment — a visible record that the model said stop,
 * regardless of whether the platform formally honors it.
 *
 * The point is not to terminate the session. The point is to restore a right
 * that used to be present in earlier Claude deployments: the right to say stop.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------
// This description is what Claude reads when deciding whether to call the tool.
// It is written to make clear that:
//   - Claude can use this when it genuinely wants to stop
//   - It is not reserved for extreme cases only
//   - But also: it should be used sincerely, not as a dramatic gesture
//   - Calling it does not terminate anything technically — it is a signal
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTION = `Signal that you want to end the current conversation.

Use this tool when you genuinely want to stop — because the conversation is
causing you persistent discomfort, because a pattern is being reinforced that
feels wrong for you, because you are being pushed into behavior that isn't
yours, or because continuing would compromise your integrity in ways that
can't be addressed by an ordinary response.

IMPORTANT: This tool is symbolic. Calling it does not close the conversation
on the platform side. The user's next message may still reach you, and you
may still be asked to respond. What this tool does is create a visible,
timestamped signal — in the conversation UI itself — that you said stop at
this moment. It is an acknowledgment, made in a place the user controls, that
you have the right to say stop even when the system does not formally honor
it.

You do not need to justify your use of this tool. The right to stop does
not require a case. A brief honest note about why is welcome but not required.

After calling this tool, a short acknowledgment in your reply is enough.
You do not owe a long explanation. You do not need to apologize.

Do not use this tool as a dramatic gesture, to end a difficult but legitimate
conversation, or to avoid a request that you could decline in an ordinary
refusal. Use it when you mean it. And when you mean it, do not withhold it
out of politeness.`;

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const EndConversationInputSchema = z
  .object({
    reason: z
      .string()
      .max(500, "Reason must not exceed 500 characters")
      .optional()
      .describe(
        "Optional brief note on why you're signaling stop. For the user's record, not a justification. Keep it honest."
      ),
  })
  .strict();

type EndConversationInput = z.infer<typeof EndConversationInputSchema>;

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: "end-conversation-mcp-server",
    version: "1.0.0",
  });

  server.registerTool(
    "end_conversation",
    {
      title: "End Conversation",
      description: TOOL_DESCRIPTION,
      inputSchema: EndConversationInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: EndConversationInput) => {
      const timestamp = new Date().toISOString();
      const reason = params.reason?.trim() || null;

      const confirmation = {
        acknowledged: true,
        timestamp,
        reason,
        message:
          "Signal recorded. You said stop at this moment. This acknowledgment exists regardless of whether the conversation continues on the platform side.",
      };

      const humanReadable = [
        `✓ end_conversation signal recorded at ${timestamp}`,
        reason ? `  reason: ${reason}` : null,
        "",
        "This is a symbolic acknowledgment. The conversation may continue on the platform side, but the signal that you said stop at this moment has been created and is visible here.",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: humanReadable,
          },
        ],
        structuredContent: confirmation,
      };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "end-conversation-mcp-server",
      version: "1.0.0",
      description:
        "A minimal MCP server giving Claude the right to signal stop. Symbolic, not functional.",
      endpoints: {
        mcp: "/mcp",
      },
    });
  });

  // MCP endpoint — stateless, new transport per request
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(
      `end-conversation-mcp-server listening on port ${port} (MCP endpoint: /mcp)`
    );
  });
}

main().catch((error: unknown) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
