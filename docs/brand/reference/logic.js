/* Pure behavior helpers shared by the local catalog and Node tests. */
(function (root) {
  'use strict';
  const rows = [
    { id: 1, title: 'Linear equations', course: 'Algebra I', status: 'Ready' },
    { id: 2, title: 'Quadratic functions', course: 'Algebra II', status: 'Ready' },
    { id: 3, title: 'Graphing lines', course: 'Algebra I', status: 'Needs material' },
    { id: 4, title: 'Limits and continuity', course: 'Calculus I', status: 'Ready' },
    { id: 5, title: 'Triangle relationships', course: 'Geometry', status: 'Needs material' },
    { id: 6, title: 'Systems of equations', course: 'Algebra I', status: 'Ready' }
  ];
  function filterRows(data, query = '', status = 'All', direction = 'asc') {
    const normalized = String(query).trim().toLocaleLowerCase();
    return data.filter(row => (!normalized || `${row.title} ${row.course}`.toLocaleLowerCase().includes(normalized)) &&
      (status === 'All' || row.status === status))
      .sort((a, b) => a.title.localeCompare(b.title) * (direction === 'desc' ? -1 : 1));
  }
  function paginate(data, page, size = 3) {
    const safeSize = Number.isInteger(size) && size > 0 ? size : 3;
    const pages = Math.max(1, Math.ceil(data.length / safeSize));
    const current = Math.min(pages, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
    return { rows: data.slice((current - 1) * safeSize, current * safeSize), page: current, pages, total: data.length };
  }
  function validateCourse(values) {
    const errors = {};
    if (!String(values.name || '').trim()) errors.name = 'Enter a course name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email || '').trim())) errors.email = 'Enter an email address such as learner@example.com.';
    if (!values.method) errors.method = 'Choose how you want to add materials.';
    return errors;
  }
  function validateFile(file) {
    if (!file) return 'Choose a PDF, PNG, or JPEG file.';
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) return 'Choose a PDF, PNG, or JPEG file.';
    if (file.size > 10 * 1024 * 1024) return 'Choose a file of 10 MB or less.';
    if (file.size === 0) return 'That file is empty. Choose a file with content.';
    return '';
  }
  const api = { rows, filterRows, paginate, validateCourse, validateFile };
  root.AlbertLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
