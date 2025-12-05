import type React from 'react';
import { Children, cloneElement, isValidElement } from 'react';
import { Streamdown } from 'streamdown';
import { Reference } from '@/components/reference';

type ParseReferencesProps = {
  text: string;
  partyShortName: string;
};

type ReferenceData = {
  pageNumber: number;
  originalText: string;
};

/**
 * Processes a string element and replaces reference placeholders with Reference components
 */
function processStringElement(
  element: string,
  references: Map<string, ReferenceData>,
  partyShortName: string,
  keyPrefix: string
): React.ReactNode {
  const placeholderRegex = /__REF_(\d+)__/g;
  let match: RegExpExecArray | null;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  match = placeholderRegex.exec(element);
  while (match !== null) {
    const placeholder = match[0];
    const refId = match[1];
    const referenceData = references.get(refId);

    if (!referenceData) {
      match = placeholderRegex.exec(element);
      continue;
    }

    // Add text before placeholder
    if (match.index > lastIndex) {
      parts.push(element.slice(lastIndex, match.index));
    }

    // Add Reference component
    parts.push(
      <Reference
        key={`${keyPrefix}-${refId}`}
        pageNumber={referenceData.pageNumber}
        partyShortName={partyShortName}
      >
        {referenceData.originalText}
      </Reference>
    );

    lastIndex = match.index + placeholder.length;
    match = placeholderRegex.exec(element);
  }

  // If we found references, return the processed parts
  if (parts.length > 0) {
    // Add remaining text after last placeholder
    if (lastIndex < element.length) {
      parts.push(element.slice(lastIndex));
    }
    return <>{parts}</>;
  }

  return element;
}

/**
 * Recursively traverses React elements and replaces reference placeholders with Reference components
 */
function replaceReferencePlaceholders(
  element: React.ReactNode,
  references: Map<string, ReferenceData>,
  partyShortName: string,
  keyPrefix = 'ref'
): React.ReactNode {
  if (typeof element === 'string') {
    return processStringElement(element, references, partyShortName, keyPrefix);
  }

  if (isValidElement(element)) {
    const children = (
      element as React.ReactElement<{ children?: React.ReactNode }>
    ).props.children;

    if (!children) {
      return element;
    }

    // Process children recursively
    const processedChildren = Children.map(children, (child, index) =>
      replaceReferencePlaceholders(
        child,
        references,
        partyShortName,
        `${keyPrefix}-${index}`
      )
    );

    return cloneElement(element, { key: element.key }, processedChildren);
  }

  return element;
}

/**
 * Parses text content and replaces page references (s. XX) with clickable Reference components
 * Uses a single Streamdown instance to maintain inline text flow
 */
export function parseReferences({
  text,
  partyShortName,
}: ParseReferencesProps): React.ReactNode {
  // For streaming compatibility, we need to avoid any processing that would
  // disrupt the streaming flow. Let's check if the text appears to be "complete"
  // (not actively streaming) before applying reference processing.

  // Regex to match page references like (s. 29) or (s.29)
  const referenceRegex = /\(s\.\s*(\d+)\)/gi;

  // Simple heuristic: if text doesn't end with common streaming indicators
  // and contains references, then process them. Otherwise, preserve streaming.
  const looksLikeStreaming =
    text.endsWith('...') || text.endsWith(' ') || text.length < 10;
  const hasReferences = referenceRegex.test(text);

  // If no references or looks like it's still streaming, preserve original behavior
  if (!hasReferences || looksLikeStreaming) {
    return <Streamdown>{text}</Streamdown>;
  }

  // Reset regex
  referenceRegex.lastIndex = 0;

  // Only process references when streaming appears complete
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  match = referenceRegex.exec(text);
  while (match !== null) {
    const fullMatch = match[0]; // e.g., "(s. 29)"
    const pageNumber = Number.parseInt(match[1], 10); // e.g., 29
    const matchStart = match.index;

    // Add text before the reference with Streamdown processing
    if (matchStart > lastIndex) {
      const textBefore = text.slice(lastIndex, matchStart);
      if (textBefore) {
        parts.push(
          <Streamdown key={`text-${keyCounter}`}>{textBefore}</Streamdown>
        );
      }
    }

    // Add the reference as a component
    parts.push(
      <Reference
        key={`ref-${keyCounter++}`}
        pageNumber={pageNumber}
        partyShortName={partyShortName}
      >
        {fullMatch}
      </Reference>
    );

    lastIndex = matchStart + fullMatch.length;
    match = referenceRegex.exec(text);
  }

  // Add remaining text after the last reference
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      parts.push(
        <Streamdown key={`text-${keyCounter}`}>{remainingText}</Streamdown>
      );
    }
  }

  // Return the parts wrapped in a span to maintain inline flow
  return <>{parts}</>;
}
