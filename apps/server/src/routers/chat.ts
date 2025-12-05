import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamToEventIterator } from '@orpc/server';
import { convertToModelMessages, streamText } from 'ai';
import { z } from 'zod';
import { MODEL } from '../domains/chat/constants/model';
import { extractMessageContent } from '../domains/chat/services/message-service';
import {
  getComparisonSystemPrompt,
  getSystemPrompt,
} from '../domains/chat/services/system-prompt-service';
import {
  getPartyName,
  partyExists,
} from '../domains/parties/services/party-service';
import {
  buildComparisonRagContext,
  buildRagContext,
} from '../domains/rag/services/rag-context-service';
import { publicProcedure } from '../lib/orpc';
import {
  generateRequestId,
  performanceLogger,
} from '../lib/performance-logger';

const chatInputSchema = z.object({
  messages: z.array(z.any()).describe('Array of UI messages from the chat'),
  partyShortName: z
    .string()
    .optional()
    .describe('Specific party short name for party-based responses'),
});

const compareChatInputSchema = z.object({
  messages: z.array(z.any()).describe('Array of UI messages from the chat'),
  selectedPartyIds: z
    .array(z.string())
    .min(1)
    .describe('Array of party short names to compare'),
  originalQuestion: z
    .string()
    .optional()
    .describe('Original question for comparison context'),
});

const openrouter = createOpenRouter({
  apiKey: process.env.OPEN_ROUTER_API_KEY,
});

export const chatRouter = {
  chat: publicProcedure.input(chatInputSchema).handler(async ({ input }) => {
    const { messages, partyShortName } = input;
    const requestId = generateRequestId();

    // Start performance tracking session
    performanceLogger.startSession(requestId);

    performanceLogger.logMilestone(requestId, 'chat-request-received', {
      messageCount: messages.length,
      partyShortName: partyShortName || null,
    });

    // Validate party exists if partyShortName is provided
    let partyName: string | null = null;
    if (partyShortName) {
      if (!partyExists(partyShortName)) {
        performanceLogger.endSession(requestId);
        throw new Error(`Party not found: ${partyShortName}`);
      }
      partyName = getPartyName(partyShortName);
    }

    // Get RAG context for party-based responses
    const ragContext = await buildRagContext(
      partyName,
      messages,
      partyShortName,
      requestId
    );

    const result = streamText({
      model: openrouter(MODEL),
      messages: convertToModelMessages(messages),
      providerOptions: {
        openai: {
          reasoning_effort: 'minimal',
        },
      },
      system: partyName
        ? getSystemPrompt(partyName, ragContext)
        : 'Du er en nyttig assistent som kan svare på generelle spörsmål.',
    });

    performanceLogger.logMilestone(requestId, 'stream-initiated', {
      hasRagContext: !!ragContext,
    });

    return streamToEventIterator(result.toUIMessageStream());
  }),

  compareChat: publicProcedure
    .input(compareChatInputSchema)
    .handler(async ({ input }) => {
      const { messages, selectedPartyIds, originalQuestion } = input;
      const requestId = generateRequestId();

      // Start performance tracking session
      performanceLogger.startSession(requestId);

      performanceLogger.logMilestone(
        requestId,
        'compare-chat-request-received',
        {
          messageCount: messages.length,
          partyCount: selectedPartyIds.length,
          parties: selectedPartyIds,
        }
      );

      // Validate all parties exist
      const invalidParties = selectedPartyIds.filter((id) => !partyExists(id));
      if (invalidParties.length > 0) {
        performanceLogger.endSession(requestId);
        throw new Error(`Invalid parties: ${invalidParties.join(', ')}`);
      }

      // Get the question from originalQuestion or last message
      let question = originalQuestion;
      if (!question) {
        const lastMessage = messages.at(-1);
        question = lastMessage ? extractMessageContent(lastMessage) : '';
      }

      if (!question) {
        performanceLogger.endSession(requestId);
        throw new Error('No question provided for comparison');
      }

      // Build comparison RAG context
      const comparisonContext = await buildComparisonRagContext(
        selectedPartyIds,
        question,
        requestId
      );

      const result = streamText({
        model: openrouter(MODEL),
        messages: convertToModelMessages(messages),
        providerOptions: {
          openai: {
            reasoning_effort: 'minimal',
          },
        },
        system: getComparisonSystemPrompt(comparisonContext),
      });

      performanceLogger.logMilestone(requestId, 'compare-stream-initiated', {
        totalResults: comparisonContext.totalResultsCount,
        partiesWithContent: comparisonContext.partyContexts.filter(
          (ctx) => ctx.ragContext !== null
        ).length,
      });

      return streamToEventIterator(result.toUIMessageStream());
    }),
};
