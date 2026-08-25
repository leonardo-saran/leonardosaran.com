---
title: "blog-template"
tags: [portfolio, projeto, web]
---

## Visão geral

Antes de publicar qualquer coisa por aqui, tomei uma decisão que diz muito sobre como encaro essa transição de carreira: em vez de usar uma plataforma pronta ou um framework popular, construí meu próprio template de blog do zero.

A motivação é a mesma que me levou a começar a pós-graduação em Engenharia de Software: não abro mão de entender a técnica por trás do código. Queria saber exatamente como cada página era renderizada, como a navegação funcionava sem recarregar o site e como o conteúdo em Markdown se transformava nas telas que você lê. Delegar tudo isso a ferramentas mágicas me parecia justamente o tipo de autonomia cega que critico quando o assunto são agentes de IA.

O resultado é um template estático, bilíngue e sem dependências: vanilla HTML, CSS e JavaScript, sem etapa de build, sem bundler e sem banco de dados. O conteúdo é escrito em arquivos `.md` com frontmatter YAML, e um GitHub Action regenera o índice de posts e as páginas do site a cada push. A navegação acontece no estilo SPA, com rotas reais e compartilháveis (`/archive`, `/post/{slug}`, `/tag/{tag}`), além de busca e ordenação integradas nas páginas de arquivo e portfólio. Tema e idioma se adaptam ao sistema na primeira visita, e o leitor pode alternar ambos com um clique.

O bilínguismo merece destaque: cada post existe apenas nos idiomas em que foi escrito, sem fallback silencioso. Foi assim que este site passou a atender leitores em português e inglês ao mesmo tempo.


## Stack

- **Frontend**: HTML, CSS e JavaScript puros, sem frameworks
- **Conteúdo**: Markdown com YAML frontmatter
- **Matemática**: MathJax 3 self-hosted, carregado sob demanda
- **Automação**: GitHub Actions regenerando índice e páginas
- **Hospedagem**: GitHub Pages, com HTTPS automático


## Resultado

O projeto é open source e está disponível no [GitHub](https://github.com/leonardo-saran/blog-template); você pode vê-lo funcionando na [demo ao vivo](https://leonardo-saran.github.io/blog-template/). Este próprio site roda sobre ele: se você está lendo este post, está vendo o template em produção.
