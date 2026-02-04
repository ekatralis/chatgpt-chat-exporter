(() => {
    function formatDate(date = new Date()) {
        return date.toISOString().split('T')[0];
    }

  function cleanMarkdown(text) {
    const mathBlocks = [];
    let i = 0;

    // Protect $$...$$ and $...$
    text = text.replace(
        /\$\$[\s\S]*?\$\$|\$(?:\\.|[^\$\\])+\$/g,
        match => {
        const key = `@@MATH_${i++}@@`;
        mathBlocks.push(match);
        return key;
        }
    );

    // Normal escaping (NON-math content only)
    text = text
        // Escape backslashes not already escaping markdown
        .replace(/\\(?![\\*_`])/g, '\\\\')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

    // Restore math blocks untouched
    mathBlocks.forEach((block, idx) => {
        text = text.replace(`@@MATH_${idx}@@`, block);
    });

    return text;
  }


  // --- NEW: MathJax -> $...$ / $$...$$ ---
  function replaceMathJaxWithDollars(root) {
    // Try to extract TeX/LaTeX from a node in a few common ways
    function extractLatex(node) {
      // 1) data-latex / data-tex attributes (some renderers)
      const attr =
        node.getAttribute?.('data-latex') ||
        node.getAttribute?.('data-tex') ||
        node.getAttribute?.('aria-label');

      if (attr && attr.trim()) return attr.trim();

      // 2) MathJax v3 sometimes stores original TeX in <annotation encoding="application/x-tex">
      const ann = node.querySelector?.('annotation[encoding="application/x-tex"]');
      if (ann && ann.textContent.trim()) return ann.textContent.trim();

      // 3) Fallback: text content (less ideal but better than losing it)
      const txt = node.textContent || '';
      return txt.replace(/\s+/g, ' ').trim();
    }

    // Decide inline vs display
    function isDisplayMath(node) {
      // MathJax v3: <mjx-container display="true">
      const mjxDisplay = node.getAttribute?.('display');
      if (mjxDisplay) return mjxDisplay === 'true';

      // KaTeX often uses .katex-display; some MathJax wrappers use .math-display
      const cls = (node.className || '').toString();
      if (cls.includes('katex-display') || cls.includes('math-display')) return true;

      // If it's in a block-ish wrapper, treat as display
      const tag = (node.tagName || '').toUpperCase();
      if (tag === 'DIV' || tag === 'P' || tag === 'CENTER') {
        // heuristic: lots of display math nodes are block containers
        // but don’t force it if it’s tiny inline math in a div
        const textLen = (node.textContent || '').trim().length;
        if (textLen > 0 && textLen < 80) return false;
        return true;
      }

      return false;
    }

    // Collect candidates (MathJax v3 + a couple of common fallbacks)
    const candidates = root.querySelectorAll(
      [
        'mjx-container',                 // MathJax v3
        '[data-latex]',                  // custom attrs
        '[data-tex]',
        '.katex',                        // if KaTeX appears too
        '.mathjax', '.MathJax'           // older wrappers
      ].join(',')
    );

    candidates.forEach(node => {
      // Avoid double-processing nested structures (e.g., .katex inside a wrapper)
      // Prefer the outermost math node in any subtree.
      const parentIsMath = node.parentElement && (
        node.parentElement.matches?.('mjx-container,[data-latex],[data-tex],.katex,.mathjax,.MathJax')
      );
      if (parentIsMath) return;

      const latex = extractLatex(node);
      if (!latex) return;

      const display = isDisplayMath(node);

      // Wrap with single/double dollars
      // Ensure we don't introduce trailing spaces weirdness
      const wrapped = display ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;

      node.parentNode.replaceChild(document.createTextNode(wrapped), node);
    });
  }

  function processMessageContent(element) {
    const clone = element.cloneNode(true);

    // Remove UI elements that shouldn't be in the export
    clone
      .querySelectorAll('button, svg, [class*="copy"], [class*="edit"], [class*="regenerate"]')
      .forEach(el => el.remove());

    // NEW: convert MathJax to $...$ / $$...$$ BEFORE flattening text
    replaceMathJaxWithDollars(clone);

    // Replace <pre><code> blocks with proper markdown
    clone.querySelectorAll('pre').forEach(pre => {
      const code = pre.innerText.trim();
      const langMatch = pre.querySelector('code')?.className?.match(/language-([a-zA-Z0-9]+)/);
      const lang = langMatch ? langMatch[1] : '';
      const codeBlock = document.createTextNode(`\n\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
      pre.parentNode.replaceChild(codeBlock, pre);
    });

    // Replace images and canvas with placeholders
    clone.querySelectorAll('img, canvas').forEach(el => {
      const placeholder = document.createTextNode('[Image or Canvas]');
      el.parentNode.replaceChild(placeholder, el);
    });

    // Convert links (including reference chips) into Markdown format
    clone.querySelectorAll('a[href]').forEach(link => {
      if (link.closest('pre, code')) return;

      const href = (link.href || '').trim();
      const lowerHref = href.toLowerCase();
      if (
        !href ||
        lowerHref.startsWith('javascript:') ||
        lowerHref.startsWith('data:') ||
        lowerHref.startsWith('vbscript:') ||
        href.startsWith('#')
      ) return;

      const text = link.textContent.replace(/\s+/g, ' ').trim() || href;
      const escapedText = text.replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1');
      const safeHref = href.replace(/\\/g, '%5C').replace(/\)/g, '%29');
      const markdown = `[${escapedText}](${safeHref})`;
      link.parentNode.replaceChild(document.createTextNode(markdown), link);
    });

    // Convert remaining HTML to clean markdown text
    return cleanMarkdown(clone.innerText.trim());
  }

    function findMessages() {
        // More specific selectors to avoid nested elements
        const selectors = [
            'div[data-message-author-role]', // Modern ChatGPT with clear author role
            'article[data-testid*="conversation-turn"]', // Conversation turns
            'div[data-testid="conversation-turn"]', // Specific conversation turn
            '.group\\/conversation-turn', // Fix for issue #6: More specific selector for conversation turns
            'div[class*="group"]:not([class*="group"] [class*="group"])', // Top-level groups only
        ];

        let messages = [];
        for (const selector of selectors) {
            messages = document.querySelectorAll(selector);
            if (messages.length > 0) {
                console.log(`Using selector: ${selector}, found ${messages.length} messages`);
                break;
            }
        }

        if (messages.length === 0) {
            // Fallback: try to find conversation container and parse its structure
            const conversationContainer = document.querySelector('[role="main"], main, .conversation, [class*="conversation"]');
            if (conversationContainer) {
                // Look for direct children that seem like message containers
                messages = conversationContainer.querySelectorAll(':scope > div, :scope > article');
                console.log(`Fallback: found ${messages.length} potential messages in conversation container`);
            }
        }

        // Filter and validate messages
        const validMessages = Array.from(messages).filter(msg => {
            const text = msg.textContent.trim();
            
            // Must have substantial content
            if (text.length < 30) return false;
            if (text.length > 100000) return false;
            
            // Skip elements that are clearly UI components
            if (msg.querySelector('input[type="text"], textarea')) return false;
            if (msg.classList.contains('typing') || msg.classList.contains('loading')) return false;
            
            // Must contain meaningful content (not just buttons/UI)
            const meaningfulText = text.replace(/\s+/g, ' ').trim();
            if (meaningfulText.split(' ').length < 5) return false;
            
            return true;
        });

        // Remove nested messages and consolidate content
        const consolidatedMessages = [];
        const usedElements = new Set();

        validMessages.forEach(msg => {
            if (usedElements.has(msg)) return;
            
            // Check if this message is nested within another valid message
            const isNested = validMessages.some(other => 
                other !== msg && other.contains(msg) && !usedElements.has(other)
            );
            
            if (!isNested) {
                consolidatedMessages.push(msg);
                usedElements.add(msg);
            }
        });

        return consolidatedMessages;
    }

    function identifySender(messageElement, index, allMessages) {
        // Method 1: Check for data attributes (most reliable)
        const authorRole = messageElement.getAttribute('data-message-author-role');
        if (authorRole) {
            return authorRole === 'user' ? 'You' : 'ChatGPT';
        }

        // Method 2: Look for avatar images with better detection
        const avatars = messageElement.querySelectorAll('img');
        for (const avatar of avatars) {
            const alt = avatar.alt?.toLowerCase() || '';
            const src = avatar.src?.toLowerCase() || '';
            const classes = avatar.className?.toLowerCase() || '';
            
            // User indicators
            if (alt.includes('user') || src.includes('user') || classes.includes('user')) {
                return 'You';
            }
            
            // Assistant indicators
            if (alt.includes('chatgpt') || alt.includes('assistant') || alt.includes('gpt') || 
                src.includes('assistant') || src.includes('chatgpt') || classes.includes('assistant')) {
                return 'ChatGPT';
            }
        }

        // Method 3: Content analysis with better patterns
        const text = messageElement.textContent.toLowerCase();
        const textStart = text.substring(0, 200); // Look at beginning of message
        
        // Strong ChatGPT indicators
        if (textStart.match(/^(i understand|i can help|here's|i'll|let me|i'd be happy|certainly|of course)/)) {
            return 'ChatGPT';
        }
        
        // Strong user indicators  
        if (textStart.match(/^(can you|please help|how do i|i need|i want|help me|could you)/)) {
            return 'You';
        }

        // Method 4: Structural analysis - look at DOM structure
        const hasCodeBlocks = messageElement.querySelectorAll('pre, code').length > 0;
        const hasLongText = messageElement.textContent.length > 200;
        const hasLists = messageElement.querySelectorAll('ul, ol, li').length > 0;
        
        // ChatGPT messages tend to be longer and more structured
        if (hasCodeBlocks && hasLongText && hasLists) {
            return 'ChatGPT';
        }

        // Method 5: Position-based fallback with better logic
        // Try to detect actual alternating pattern by looking at content characteristics
        if (index > 0 && allMessages[index - 1]) {
            const prevText = allMessages[index - 1].textContent;
            const currentText = messageElement.textContent;
            
            // If previous was short and current is long, likely user -> assistant
            if (prevText.length < 100 && currentText.length > 300) {
                return 'ChatGPT';
            }
            
            // If previous was long and current is short, likely assistant -> user  
            if (prevText.length > 300 && currentText.length < 100) {
                return 'You';
            }
        }

        // Final fallback
        return index % 2 === 0 ? 'You' : 'ChatGPT';
    }

    function extractConversationTitle() {
        // Try to get actual conversation title
        const titleSelectors = [
            'h1:not([class*="hidden"])',
            '[class*="conversation-title"]',
            '[data-testid*="conversation-title"]',
            'title'
        ];

        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                const title = element.textContent.trim();
                // Avoid generic titles
                if (!['chatgpt', 'new chat', 'untitled', 'chat'].includes(title.toLowerCase())) {
                    return title;
                }
            }
        }

        return 'Conversation with ChatGPT';
    }

    // Main export logic
    const messages = findMessages();
    
    if (messages.length === 0) {
        alert('No messages found. The page structure may have changed.');
        return;
    }

    console.log(`Processing ${messages.length} messages...`);

    const lines = [];
    const title = extractConversationTitle();
    const date = formatDate();
    const url = window.location.href;

    lines.push(`# ${title}\n`);
    lines.push(`**Date:** ${date}`);
    lines.push(`**Source:** [chat.openai.com](${url})\n`);
    lines.push(`---\n`);

    // Process messages with better duplicate detection
    const processedMessages = [];
    const seenContent = new Set();

    messages.forEach((messageElement, index) => {
        const sender = identifySender(messageElement, index, messages);
        const content = processMessageContent(messageElement);
        
        // Skip if empty or too short
        if (!content || content.trim().length < 30) {
            console.log(`Skipping message ${index}: too short or empty`);
            return;
        }

        // Create a content hash for duplicate detection
        const contentHash = content.substring(0, 100).replace(/\s+/g, ' ').trim();
        if (seenContent.has(contentHash)) {
            console.log(`Skipping message ${index}: duplicate content`);
            return;
        }
        seenContent.add(contentHash);

        processedMessages.push({
            sender,
            content,
            originalIndex: index
        });
    });

    // Apply sender sequence correction
    for (let i = 1; i < processedMessages.length; i++) {
        const current = processedMessages[i];
        const previous = processedMessages[i - 1];
        
        // If we have two consecutive messages from the same sender, try to fix it
        if (current.sender === previous.sender) {
            // Use content analysis to determine which should be flipped
            const currentLength = current.content.length;
            const previousLength = previous.content.length;
            
            // If current message is much longer, it's likely ChatGPT
            if (currentLength > previousLength * 2 && currentLength > 500) {
                current.sender = 'ChatGPT';
            } else if (previousLength > currentLength * 2 && previousLength > 500) {
                previous.sender = 'ChatGPT';
                current.sender = 'You';
            } else {
                // Default alternating fix
                current.sender = current.sender === 'You' ? 'ChatGPT' : 'You';
            }
            
            console.log(`Fixed consecutive ${previous.sender} messages at positions ${i-1} and ${i}`);
        }
    }

    // Generate final output
    processedMessages.forEach(({ sender, content }) => {
        lines.push(`### **${sender}**\n`);
        lines.push(content);
        lines.push('\n---\n');
    });

    // Create and download file
    const markdownContent = lines.join('\n');
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url2;
    // Use document title for better file naming (Issue #12)
    const safeTitle = document.title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    a.download = safeTitle ? `${safeTitle} (${date}).md` : `ChatGPT_Conversation_${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url2);

    console.log(`Export completed: ${processedMessages.length} messages exported`);
})();