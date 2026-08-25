---
title: "blog-template"
tags: [portfolio, project, web]
---

## Overview

Before publishing anything here, I made a decision that says a lot about how I approach this career transition: instead of using an off-the-shelf platform or a popular framework, I built my own blog template from scratch.

The motivation is the same one that led me to Software Engineering postgraduate course: I refuse to skip the technique behind the code. I wanted to know exactly how each page was rendered, how navigation worked without reloading the site, and how Markdown content became the pages you are reading. Handing all of that over to magic tools felt precisely like the blind autonomy I criticize when the subject is AI agents.

The result is a static, bilingual, zero-dependency template: vanilla HTML, CSS, and JavaScript, with no build step, no bundler, and no database. Content is written in plain `.md` files with YAML frontmatter, and a GitHub Action regenerates the post index and site pages on every push. Navigation works SPA-style, with real, shareable paths (`/archive`, `/post/{slug}`, `/tag/{tag}`), plus built-in search and sorting on the archive and portfolio pages. Theme and language adapt to the system on first visit, and readers can toggle either with one click.

Bilingualism deserves special mention: each post exists only in the languages it was written in, with no silent fallback. That is how this site now serves readers in Portuguese and English at the same time.


## Tech stack

- **Frontend**: pure HTML, CSS, and JavaScript, no frameworks
- **Content**: Markdown with YAML frontmatter
- **Math**: self-hosted MathJax 3, loaded on demand
- **Automation**: GitHub Actions regenerating index and site files
- **Hosting**: GitHub Pages, with automatic HTTPS


## Outcome

The project is open source and available on [GitHub](https://github.com/leonardo-saran/blog-template); you can see it running in the [live demo](https://leonardo-saran.github.io/blog-template/). This very site runs on it: if you are reading these words, you are looking at the template in production.
