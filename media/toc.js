// Builds a floating table-of-contents from the document headings and enables
// quick jump between sections. Shared by the VS Code Markdown preview
// (markdown.previewScripts) and the local preview server.
(function () {
  'use strict';

  // Incremented on every real (re)build. Document/window listeners added by a
  // build capture their own generation and become inert once superseded, so
  // rebuilds (triggered when headings change) don't leak stale handlers that
  // mutate global state against a detached TOC.
  var buildGen = 0;

  function slugify(text) {
    return (
      text
        .toLowerCase()
        .trim()
        .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section'
    );
  }

  // VS Code's preview renders YAML frontmatter as `table.frontmatter`. Add an
  // Obsidian-style "Properties" label and turn bare URLs into clickable links
  // (frontmatter scalars are plain text by default). Idempotent.
  function enhanceFrontmatter() {
    var scope = document.querySelector('.markdown-body') || document.body;
    var tables = scope.querySelectorAll('table.frontmatter');
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var prev = table.previousElementSibling;
      if (!(prev && prev.classList && prev.classList.contains('md-frontmatter-label'))) {
        var label = document.createElement('div');
        label.className = 'md-frontmatter-label';
        label.textContent = 'Properties';
        table.parentNode.insertBefore(label, table);
      }
      linkifyUrls(table);
    }
  }

  function linkifyUrls(root) {
    var cells = root.querySelectorAll('td');
    var urlRe = /https?:\/\/[^\s<>"']+/g;
    for (var c = 0; c < cells.length; c++) {
      var walker = document.createTreeWalker(cells[c], NodeFilter.SHOW_TEXT, null);
      var pending = [];
      var node;
      while ((node = walker.nextNode())) {
        if (node.parentNode && node.parentNode.closest && (node.parentNode.closest('a') || node.parentNode.closest('code'))) {
          continue;
        }
        if (/https?:\/\//.test(node.nodeValue)) {
          pending.push(node);
        }
      }
      for (var p = 0; p < pending.length; p++) {
        var textNode = pending[p];
        var text = textNode.nodeValue;
        var frag = document.createDocumentFragment();
        var last = 0;
        var m;
        urlRe.lastIndex = 0;
        while ((m = urlRe.exec(text))) {
          if (m.index > last) {
            frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          }
          var a = document.createElement('a');
          a.href = m[0];
          a.textContent = m[0];
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          frag.appendChild(a);
          last = urlRe.lastIndex;
        }
        if (last < text.length) {
          frag.appendChild(document.createTextNode(text.slice(last)));
        }
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }

  function build() {
    var body = document.querySelector('.markdown-body') || document.body;
    var headings = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var items = [];

    headings.forEach(function (heading) {
      if (heading.closest && heading.closest('.md-toc')) {
        return;
      }
      var text = (heading.textContent || '').trim();
      if (!text) {
        return;
      }
      if (!heading.id) {
        var base = slugify(text);
        var id = base;
        var n = 1;
        while (document.getElementById(id) && document.getElementById(id) !== heading) {
          id = base + '-' + n++;
        }
        heading.id = id;
      }
      items.push({
        level: Number(heading.tagName.substring(1)),
        text: text,
        el: heading,
      });
    });

    if (items.length < 2) {
      return;
    }

    // Skip work if an up-to-date TOC already exists; otherwise drop any stale or
    // partially-rendered TOC so the rebuild reflects the current headings exactly.
    var sig = items
      .map(function (item) {
        return item.level + ':' + item.text;
      })
      .join('|');
    var existingNav = document.querySelector('.md-toc');
    if (existingNav && existingNav.getAttribute('data-md-toc-sig') === sig) {
      return;
    }
    if (existingNav) {
      existingNav.remove();
    }
    var existingToggle = document.querySelector('.md-toc-toggle');
    if (existingToggle) {
      existingToggle.remove();
    }

    var minLevel = items.reduce(function (min, item) {
      return Math.min(min, item.level);
    }, 6);

    var myGen = ++buildGen;

    // Width below which the TOC starts collapsed (matches the CSS breakpoint).
    var NARROW = 1180;
    var tocOpen = window.innerWidth > NARROW;
    var userToggled = false;

    var nav = document.createElement('nav');
    nav.className = 'md-toc';
    nav.setAttribute('data-md-toc-sig', sig);

    var title = document.createElement('div');
    title.className = 'md-toc-title';
    title.textContent = 'On this page';
    nav.appendChild(title);

    var list = document.createElement('ul');
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'md-toc-item md-toc-l' + (item.level - minLevel);

      var link = document.createElement('a');
      link.textContent = item.text;
      link.href = '#' + item.el.id;
      link.title = item.text;
      link.addEventListener('click', function (event) {
        event.preventDefault();
        item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (history && history.replaceState) {
          history.replaceState(null, '', '#' + item.el.id);
        }
        // On narrow layouts the TOC overlays the text, so close it after a jump.
        if (window.innerWidth <= NARROW) {
          tocOpen = false;
          applyTocState();
        }
      });

      item.link = link;
      li.appendChild(link);
      list.appendChild(li);
    });
    nav.appendChild(list);
    document.body.appendChild(nav);

    var toggle = document.createElement('button');
    toggle.className = 'md-toc-toggle';
    toggle.setAttribute('aria-label', 'Show table of contents');
    toggle.title = 'Show table of contents';
    toggle.textContent = '\u2630';

    function applyTocState() {
      nav.classList.toggle('is-open', tocOpen);
      nav.classList.toggle('is-closed', !tocOpen);
      // Only used to hide the opener button while the panel is visible.
      document.body.classList.toggle('md-toc-open', tocOpen);
      toggle.setAttribute('aria-expanded', String(tocOpen));
    }

    toggle.addEventListener('click', function (event) {
      // Stop this click from reaching the document-level dismiss handler below.
      event.stopPropagation();
      userToggled = true;
      tocOpen = !tocOpen;
      applyTocState();
    });
    document.body.appendChild(toggle);

    // Clicking anywhere outside the panel hides it (no explicit close button).
    document.addEventListener('click', function (event) {
      if (myGen !== buildGen || !tocOpen) {
        return;
      }
      if (nav.contains(event.target) || toggle.contains(event.target)) {
        return;
      }
      userToggled = true;
      tocOpen = false;
      applyTocState();
    });

    // Until the user makes a choice, follow the available width on resize.
    window.addEventListener('resize', function () {
      if (myGen !== buildGen || userToggled) {
        return;
      }
      var next = window.innerWidth > NARROW;
      if (next !== tocOpen) {
        tocOpen = next;
        applyTocState();
      }
    });

    applyTocState();

    function onScroll() {
      if (myGen !== buildGen) {
        return;
      }
      var current = items[0];
      for (var i = 0; i < items.length; i++) {
        if (items[i].el.getBoundingClientRect().top <= 120) {
          current = items[i];
        } else {
          break;
        }
      }
      items.forEach(function (item) {
        if (item.link) {
          item.link.classList.toggle('active', item === current);
        }
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // The VS Code Markdown preview injects the rendered HTML AFTER preview scripts
  // evaluate (readyState is already past "loading") and replaces the body content
  // on every update. A one-shot build therefore runs against an empty document and
  // never recovers. Build now, then rebuild (debounced) whenever the body changes.
  var rebuildTimer = null;
  function scheduleBuild() {
    if (rebuildTimer) {
      return;
    }
    rebuildTimer = setTimeout(function () {
      rebuildTimer = null;
      build();
      enhanceFrontmatter();
    }, 80);
  }

  function watchForContent() {
    if (!document.body) {
      return;
    }
    new MutationObserver(scheduleBuild).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  build();
  enhanceFrontmatter();
  if (document.body) {
    watchForContent();
  } else {
    document.addEventListener('DOMContentLoaded', watchForContent);
  }
})();
