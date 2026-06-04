// Builds a floating table-of-contents from the document headings and enables
// quick jump between sections. Shared by the VS Code Markdown preview
// (markdown.previewScripts) and the local preview server.
(function () {
  'use strict';

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

  function build() {
    if (document.querySelector('.md-toc')) {
      return;
    }

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

    var minLevel = items.reduce(function (min, item) {
      return Math.min(min, item.level);
    }, 6);

    var nav = document.createElement('nav');
    nav.className = 'md-toc';

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
        nav.classList.remove('open');
      });

      item.link = link;
      li.appendChild(link);
      list.appendChild(li);
    });
    nav.appendChild(list);
    document.body.appendChild(nav);

    var toggle = document.createElement('button');
    toggle.className = 'md-toc-toggle';
    toggle.setAttribute('aria-label', 'Toggle table of contents');
    toggle.textContent = '\u2630';
    toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
    document.body.appendChild(toggle);

    function onScroll() {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
