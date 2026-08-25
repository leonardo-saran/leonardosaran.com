export function filterItems(query, items, sortBy = 'new') {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  let result = items;

  if (query && query.trim()) {
    const lowerQuery = query.toLowerCase().trim();
    result = result.filter(item => {
      const title = (item.title || '').toLowerCase();
      const excerpt = (item.excerpt || '').toLowerCase();
      return title.includes(lowerQuery) || excerpt.includes(lowerQuery);
    });
  }

  result = sortItems(result, sortBy);

  return result;
}

export function filterPosts(query, posts, sortBy = 'new') {
  return filterItems(query, posts, sortBy);
}

export function filterProjects(query, projects, sortBy = 'new') {
  return filterItems(query, projects, sortBy);
}

export function filterPostsByTag(query, posts, sortBy = 'new') {
  if (!posts || !Array.isArray(posts)) {
    return [];
  }

  let result = posts;

  if (query && query.trim()) {
    const lowerQuery = query.toLowerCase().trim();
    result = result.filter(post =>
      (post.tags || []).some(tag => tag.toLowerCase() === lowerQuery)
    );
  }

  result = sortItems(result, sortBy);

  return result;
}

const SORT_COMPARATORS = {
  new: (a, b) => {
    const dateA = new Date(a.date || '1970-01-01');
    const dateB = new Date(b.date || '1970-01-01');
    return dateB - dateA;
  },
  old: (a, b) => {
    const dateA = new Date(a.date || '1970-01-01');
    const dateB = new Date(b.date || '1970-01-01');
    return dateA - dateB;
  },
  az: (a, b) => {
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    return titleA.localeCompare(titleB);
  },
  za: (a, b) => {
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    return titleB.localeCompare(titleA);
  },
};

export function sortItems(items, sortBy) {
  const result = [...items];

  const comparator = SORT_COMPARATORS[sortBy] || SORT_COMPARATORS.new;
  result.sort(comparator);

  return result;
}
