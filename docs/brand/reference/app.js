(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const L = window.AlbertLogic;
  const navigation = $('#catalog-navigation');
  const toggle = $('#navigation-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (link) {
      toggle.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('is-open');
      if (link.hash) requestAnimationFrame(() => {
        const heading = document.querySelector(link.hash)?.querySelector('h1,h2');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      });
    }
  });
  function markLocation() {
    navigation.querySelectorAll('nav a').forEach(a => {
      if (a.hash === (location.hash || '#overview')) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', markLocation);
  markLocation();

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function activateTab(tab) {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); activateTab(tabs[next]); tabs[next].focus(); }
    });
  });

  const fieldIds = { name: 'course-name', email: 'course-email', method: 'course-method' };
  $('#course-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const errors = L.validateCourse(values);
    $('#form-error-list').replaceChildren();
    $('#form-success').hidden = true;
    Object.entries(fieldIds).forEach(([key, id]) => {
      const input = document.getElementById(id);
      const error = document.getElementById(id + '-error');
      error.textContent = errors[key] || '';
      error.hidden = !errors[key];
      if (errors[key]) {
        input.setAttribute('aria-invalid', 'true');
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#' + id;
        link.textContent = errors[key];
        link.addEventListener('click', e => { e.preventDefault(); input.focus(); });
        li.append(link);
        $('#form-error-list').append(li);
      } else input.removeAttribute('aria-invalid');
    });
    const hasErrors = Object.keys(errors).length > 0;
    $('#form-errors').hidden = !hasErrors;
    if (hasErrors) $('#form-errors').focus();
    else {
      $('#form-success').textContent = `“${values.name.trim()}” is ready for the next setup step in this preview. Nothing has been saved or sent.`;
      $('#form-success').hidden = false;
    }
  });
  $('#worksheet-file').addEventListener('change', event => {
    const file = event.target.files[0];
    const error = L.validateFile(file);
    $('#file-result').textContent = error || `${file.name} · ${(file.size / 1024).toFixed(1)} KB · selected locally`;
    $('#file-result').classList.toggle('field-error', Boolean(error));
    if (error) event.target.setAttribute('aria-invalid', 'true');
    else event.target.removeAttribute('aria-invalid');
  });
  $('#motion-preference').addEventListener('change', event => document.documentElement.classList.toggle('reduced-motion', event.target.checked));

  const tableState = { page: 1, direction: 'asc' };
  function renderTable() {
    const filtered = L.filterRows(L.rows, $('#worksheet-search').value, $('#status-filter').value, tableState.direction);
    const result = L.paginate(filtered, tableState.page);
    tableState.page = result.page;
    $('#worksheet-rows').replaceChildren();
    result.rows.forEach(row => {
      const tr = document.createElement('tr');
      [row.title, row.course, row.status].forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 2) {
          const badge = document.createElement('span');
          badge.className = 'badge albert-badge ' + (value === 'Ready' ? 'badge--success' : 'badge--pending');
          badge.textContent = value;
          cell.append(badge);
        } else cell.textContent = value;
        tr.append(cell);
      });
      $('#worksheet-rows').append(tr);
    });
    $('#table-count').textContent = `${result.total} example worksheet${result.total === 1 ? '' : 's'} found.`;
    $('#table-empty').hidden = result.total > 0;
    $('#page-label').textContent = `Page ${result.page} of ${result.pages}`;
    $('#previous-page').disabled = result.page <= 1;
    $('#next-page').disabled = result.page >= result.pages;
    $('#title-sort-header').setAttribute('aria-sort', tableState.direction === 'asc' ? 'ascending' : 'descending');
  }
  ['#worksheet-search', '#status-filter'].forEach(selector => $(selector).addEventListener(selector === '#worksheet-search' ? 'input' : 'change', () => { tableState.page = 1; renderTable(); }));
  $('#sort-title').addEventListener('click', () => { tableState.direction = tableState.direction === 'asc' ? 'desc' : 'asc'; tableState.page = 1; renderTable(); });
  $('#previous-page').addEventListener('click', () => { tableState.page -= 1; renderTable(); });
  $('#next-page').addEventListener('click', () => { tableState.page += 1; renderTable(); });
  $('#clear-filters').addEventListener('click', () => { $('#worksheet-search').value = ''; $('#status-filter').value = 'All'; tableState.page = 1; renderTable(); });
  renderTable();

  let toastSource = $('#show-toast');
  function toast(message, source = $('#show-toast')) { toastSource = source; $('#toast-text').textContent = message; $('#toast').hidden = false; }
  $('#show-toast').addEventListener('click', () => toast('Example preference updated. This confirmation stays until dismissed.'));
  $('#dismiss-toast').addEventListener('click', () => { $('#toast').hidden = true; toastSource.focus(); });
  $('#retry-example').addEventListener('click', () => {
    $('#error-example').classList.remove('notice--error');
    $('#error-example').classList.add('notice--success');
    $('#error-example').replaceChildren();
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.tabIndex = -1; status.textContent = 'Recovery example complete. A real retry would request the worksheet again.';
    $('#error-example').append(status);
    status.focus();
  });
  let stage = 1;
  const stages = ['Choose materials', 'Review notation', 'Ready to practice'];
  let loadingSpecimen = false;
  $('#loading-toggle').addEventListener('click', () => {
    loadingSpecimen = !loadingSpecimen;
    $('#loading-content').setAttribute('aria-busy', String(loadingSpecimen));
    $('#loading-skeleton').hidden = !loadingSpecimen;
    $('#loading-ready').hidden = loadingSpecimen;
    $('#loading-status').textContent = loadingSpecimen ? 'Loading-state specimen. No network request is running.' : 'Example content is ready.';
    $('#loading-toggle').textContent = loadingSpecimen ? 'Preview ready state' : 'Preview loading state';
  });
  $('#advance-stage').addEventListener('click', () => {
    stage = stage % 3 + 1;
    $('#import-progress').value = stage;
    $('#progress-label').textContent = `Stage ${stage} of 3 · ${stages[stage - 1]}`;
  });
  const dialog = $('#review-dialog');
  $('#review-trigger').addEventListener('click', () => { dialog.returnValue = ''; dialog.showModal(); dialog.querySelector('button[value="cancel"]').focus(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(item => item.getClientRects().length);
    const first = controls[0]; const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') toast('Example import confirmed. No files were uploaded.', $('#review-trigger'));
    $('#review-trigger').focus();
  });
  $('#help-trigger').addEventListener('click', () => {
    const open = $('#help-trigger').getAttribute('aria-expanded') !== 'true';
    $('#help-trigger').setAttribute('aria-expanded', String(open));
    $('#help-content').hidden = !open;
  });
  $('#help-trigger').addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('#help-trigger').setAttribute('aria-expanded', 'false'); $('#help-content').hidden = true; }
  });

  document.querySelectorAll('[data-pattern]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-pattern]').forEach(item => {
      const selected = item === button;
      item.setAttribute('aria-pressed', String(selected));
      document.getElementById('pattern-' + item.dataset.pattern).hidden = !selected;
    });
  }));
  let onboardingStep = 0;
  const onboarding = [
    ['Choose the course.', 'Start with its name and the notation you are using.'],
    ['Add the materials.', 'Upload notes and worksheets or connect the course repository.'],
    ['Your study space is ready.', 'Start with a worksheet and ask Albert for one useful hint.']
  ];
  function renderOnboarding() {
    $('#onboarding-content h4').textContent = onboarding[onboardingStep][0];
    $('#onboarding-content p').textContent = onboarding[onboardingStep][1];
    document.querySelectorAll('.stepper li').forEach((item, index) => { if (index === onboardingStep) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    $('#onboarding-back').disabled = onboardingStep === 0;
    $('#onboarding-next').textContent = onboardingStep === 2 ? 'Restart preview' : 'Preview next step';
  }
  $('#onboarding-next').addEventListener('click', () => { onboardingStep = (onboardingStep + 1) % 3; renderOnboarding(); });
  $('#onboarding-back').addEventListener('click', () => { onboardingStep = Math.max(0, onboardingStep - 1); renderOnboarding(); });
  $('#show-step').addEventListener('click', () => {
    $('#hint-text').textContent = 'Divide both sides by 2: 2x ÷ 2 = 8 ÷ 2. What does each side simplify to?';
    $('#tutor-pose').src = '../assets/mascot/normalized/512/albert-explaining.png';
    $('#tutor-status').textContent = 'One worked operation is visible. You can take the next step.';
  });
  $('#let-try').addEventListener('click', () => {
    $('#hint-text').textContent = 'Take your time. I’m here when you need another hint.';
    $('#tutor-pose').src = '../assets/mascot/normalized/512/albert-waiting.png';
    $('#tutor-status').textContent = 'This is a layout specimen; handwriting is implemented in the actual product.';
  });
})();
