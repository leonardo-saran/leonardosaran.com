---
title: "Getting Started with Your Blog"
tags: [getting-started, markdown]
---

Welcome! This sample post demonstrates every feature the blog supports, with real working content. Copy this file into a dated folder in the archive hierarchy, register the slug in the archive index, and replace the content with your own.

## Unordered list

A blog post needs a few things:

- A title that says what the post is about
- At least one **tag**, so readers can filter by topic
- A date in the folder path
- A closing thought

## Ordered list

Publishing steps:

1. Write the post in Markdown
2. Save it as index.md (English) or `index.**.md` (`**` is the second language code)
3. Add the slug to the archive index
4. Commit and push: the site updates automatically

## Task list

Before you publish:

- [x] Draft the content
- [x] Check the frontmatter: title and tags
- [ ] Add an image from src/assets
- [ ] Review the post in every active language

## Table

| Feature | Syntax | Result |
|---------|--------|--------|
| Bold | two asterisks around the text | strong emphasis |
| Inline code | backticks around the text | monospace |
| Strikethrough | two tildes around the text | struck-through text |
| LaTeX | &#96;$...$&#96; (inline) or &#96;$$...$$&#96; (display) | math rendering |

## Math

Rendered by the site's self-hosted MathJax: standard LaTeX works. Inline: the area of a circle is `$A = \pi r^2$`.

Display math sits on its own line:

`$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`

Roots work with or without exponents: `$\sqrt{x^2 + y^2}$` and `$\sqrt{z}$`.

## Code

Fenced code blocks carry their language and get a copy button:

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```

Inline code like `const slug = "hello-world"` stays inline.

## Links

External links open in a new tab, for example [example.com](https://example.com). Internal links navigate in place: try the [archive page](/archive).

Post images live inside the post's own folder, next to index.md, and external links open in a new tab.

## Strikethrough

~~This sentence was removed during editing~~: keep what matters.

## Quote

> A blog is only as good as its latest post. Write something true, and the rest follows.

## Image

Images are served by the site itself from the templates folder:

![A simple landscape illustration](src/content/templates/example-image.svg)

When you are done, commit and push: the content index and site files regenerate automatically.
