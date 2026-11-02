---
title: "blog-template"
tags: [portfolio, project, web]
---

## Overview

Before publishing anything here, I made a decision that says a lot about the way I approach learning and working: instead of using a ready-made platform or a popular framework, I built my own blog template from scratch.

The motivation was simple: I am not willing to give up understanding the logic and functionality behind the code. I wanted to know exactly how each page was rendered, how navigation worked without reloading the site, and how Markdown content was transformed into the pages you read.

The result is a static, bilingual template built using only vanilla HTML, CSS, and JavaScript, with no build step, bundler, or database. Content is written in `.md` files with YAML frontmatter, and GitHub Actions regenerates the post index and site pages on every push. Navigation works in an SPA-like fashion, with real, shareable routes (`/archive`, `/post/{slug}`, `/tag/{tag}`), as well as built-in search and sorting on the archive and portfolio pages. The theme and language adapt to system preferences on the first visit, and readers can switch between them with a single click.

The bilingual aspect deserves special attention. Each post is available only in the languages it was written in, with no silent fallback. This is how the site came to serve readers in both Portuguese and English.

## Stack

- **Frontend**: Pure HTML, CSS, and JavaScript, without frameworks
- **Content**: Markdown with YAML frontmatter
- **Mathematics**: MathJax 3 self-hosted, loaded on demand
- **Automation**: GitHub Actions for automatic index and page generation
- **Hosting**: GitHub Pages, with automatic HTTPS

## Result

The project is open source and available on [GitHub](https://github.com/leonardo-saran/blog-template); you can also see it in action through the [live demo](https://leonardo-saran.github.io/blog-template/). This very website runs on it: if you're reading this post, you're seeing the template in production.