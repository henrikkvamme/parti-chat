'use client';

import { type ComponentProps, memo, useEffect, useRef } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

type ResponseProps = ComponentProps<typeof Streamdown> & {
  partyShortName?: string;
};

export const Response = memo(
  ({ className, partyShortName, children, ...props }: ResponseProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Post-process references after streaming completes
    useEffect(() => {
      if (
        !(partyShortName && containerRef.current) ||
        typeof children !== 'string'
      ) {
        return;
      }

      const container = containerRef.current;
      const referenceRegex = /\(s\.\s*(\d+)\)/g;

      // Wait for streaming to potentially complete before processing
      const processReferences = () => {
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT
        );

        const textNodes: Text[] = [];
        let node: Node | null = walker.nextNode();

        while (node) {
          if (node.textContent?.match(referenceRegex)) {
            textNodes.push(node as Text);
          }
          node = walker.nextNode();
        }

        for (const textNode of textNodes) {
          const text = textNode.textContent;
          if (!text) {
            continue;
          }

          const matches = Array.from(text.matchAll(referenceRegex));
          if (matches.length === 0) {
            continue;
          }

          const parent = textNode.parentNode;
          if (!parent) {
            continue;
          }

          // Check if this text node is already inside a reference link to avoid nesting
          let currentElement = textNode.parentElement;
          let isInsideReferenceLink = false;
          while (currentElement) {
            if (
              currentElement.tagName === 'A' &&
              currentElement.className.includes('text-blue-600')
            ) {
              isInsideReferenceLink = true;
              break;
            }
            currentElement = currentElement.parentElement;
          }

          if (isInsideReferenceLink) {
            continue;
          }

          let lastIndex = 0;
          for (const match of matches) {
            const [fullMatch, pageNum] = match;
            const start = match.index ?? 0;

            // Add text before reference
            if (start > lastIndex) {
              const beforeText = text.slice(lastIndex, start);
              parent.insertBefore(
                document.createTextNode(beforeText),
                textNode
              );
            }

            // Create clickable reference
            const link = document.createElement('a');
            link.className =
              'mx-0.5 inline text-blue-600 underline decoration-dotted underline-offset-2 transition-colors hover:text-blue-800';
            link.href = `/party-programs/${partyShortName.toLowerCase()}.pdf#page=${pageNum}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = fullMatch;
            link.title = `Åpne ${partyShortName} partiprogram på side ${pageNum}`;

            parent.insertBefore(link, textNode);
            lastIndex = start + fullMatch.length;
          }

          // Add remaining text
          if (lastIndex < text.length) {
            const remainingText = text.slice(lastIndex);
            parent.insertBefore(
              document.createTextNode(remainingText),
              textNode
            );
          }

          parent.removeChild(textNode);
        }
      };

      // Process immediately and also after a delay to catch streaming completion
      const STREAM_PROCESSING_DELAY = 100;
      processReferences();
      const timeoutId = setTimeout(processReferences, STREAM_PROCESSING_DELAY);
      return () => clearTimeout(timeoutId);
    }, [partyShortName, children]);

    return (
      <div ref={containerRef}>
        <Streamdown
          className={cn(
            'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            'prose prose-sm prose-gray max-w-none',
            // Fix bullet point positioning and styling
            '[&_ul]:!pl-6 [&_ol]:!pl-6',
            '[&_ul_li]:!ml-0 [&_ol_li]:!ml-0 [&_li]:!pl-0',
            '[&_ul_li::marker]:!text-gray-500 [&_ol_li::marker]:!text-gray-500',
            '[&_ul_li]:!mb-1 [&_ol_li]:!mb-1',
            '[&_ul]:!list-disc [&_ol]:!list-decimal',
            '[&_ul]:!mb-3 [&_ol]:!mb-3',
            // Better paragraph and heading spacing
            '[&_p]:!mb-2 [&_p:last-child]:!mb-0',
            '[&_h1]:!text-lg [&_h1]:!font-semibold [&_h1]:!mb-2 [&_h1]:!mt-0',
            '[&_h2]:!text-base [&_h2]:!font-semibold [&_h2]:!mb-2 [&_h2]:!mt-0',
            '[&_h3]:!text-sm [&_h3]:!font-semibold [&_h3]:!mb-1 [&_h3]:!mt-0',
            // Ensure inline elements flow properly
            '[&_a]:!inline [&_span]:!inline',
            className
          )}
          {...props}
        >
          {children}
        </Streamdown>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.partyShortName === nextProps.partyShortName
);

Response.displayName = 'Response';
