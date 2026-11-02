---
title: "blog-template"
tags: [portfolio, projeto, web]
---

## Visão geral

Antes de publicar qualquer coisa por aqui, tomei uma decisão que diz muito sobre minha maneira de aprender e trabalhar: em vez de usar uma plataforma pronta ou um framework popular, construí meu próprio template de blog do zero.

A motivação foi simples, visto que eu não abro mão de entender a lógica e o funcionamento por trás do código. Queria saber exatamente como cada página era renderizada, como a navegação funcionava sem recarregar o site e como o conteúdo em Markdown se transformava nas telas que você lê.

O resultado é um template estático e bilíngue, utilizando apenas HTML, CSS e JavaScript puros, sem etapa de build, sem bundler e sem banco de dados. O conteúdo é escrito em arquivos `.md` com frontmatter YAML, e o GitHub Actions regenera o índice de posts e as páginas do site a cada push. A navegação acontece no estilo SPA, com rotas reais e compartilháveis (`/archive`, `/post/{slug}`, `/tag/{tag}`), além de busca e ordenação integradas nas páginas de arquivo e portfólio. Tema e idioma se adaptam ao sistema na primeira visita, e o leitor pode alternar ambos com um clique.

O bilinguismo merece destaque. Cada post existe apenas nos idiomas em que foi escrito, sem fallback silencioso. Foi assim que este site passou a atender leitores em português e inglês ao mesmo tempo.


## Stack

- **Frontend**: HTML, CSS e JavaScript puros, sem frameworks
- **Conteúdo**: Markdown com YAML frontmatter
- **Matemática**: MathJax 3 self-hosted, carregado sob demanda
- **Automação**: GitHub Actions para regeneração automática do índice e das páginas
- **Hospedagem**: GitHub Pages, com HTTPS automático


## Resultado

O projeto é open source e está disponível no [GitHub](https://github.com/leonardo-saran/blog-template); você pode vê-lo funcionando na [demo ao vivo](https://leonardo-saran.github.io/blog-template/). Este próprio site roda sobre ele: se você está lendo este post, está vendo o template em produção.
