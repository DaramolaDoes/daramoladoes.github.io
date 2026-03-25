const boardContainer = document.getElementById('boardContainer');
const template = document.getElementById('boardCardTemplate');
const modeButtons = [...document.querySelectorAll('.mode-btn')];
let cards = [];
let currentMode = 'skim';

fetch('assets/data/board.json')
  .then(res => res.json())
  .then(data => {
    renderBoard(data);
    applyMode(currentMode);
  })
  .catch(err => {
    boardContainer.innerHTML = `<p>Unable to load board data: ${err.message}</p>`;
  });

function renderBoard(items) {
  items.forEach(item => {
    const node = template.content.firstElementChild.cloneNode(true);
    if (item.marquee) node.classList.add('marquee');

    node.querySelector('.rank').textContent = String(item.rank).padStart(2, '0');
    node.querySelector('.card-category').textContent = item.category;
    node.querySelector('h3').textContent = item.title;
    node.querySelector('.card-summary').textContent = item.summary;
    node.querySelector('.peek-row').textContent = item.peek;
    node.querySelector('.detail-problem').textContent = item.details.problem;
    node.querySelector('.detail-solution').textContent = item.details.solution;

    const tagRow = node.querySelector('.tag-row');
    item.tags.forEach(tag => {
      const el = document.createElement('span');
      el.className = 'tag';
      el.textContent = tag;
      tagRow.appendChild(el);
    });

    const artifactList = node.querySelector('.artifact-list');
    item.details.artifacts.forEach(artifact => {
      const li = document.createElement('li');
      li.textContent = artifact;
      artifactList.appendChild(li);
    });

    const signalList = node.querySelector('.signal-list');
    item.details.signals.forEach(signal => {
      const li = document.createElement('li');
      li.textContent = signal;
      signalList.appendChild(li);
    });

    const expandBtn = node.querySelector('.expand-btn');
    expandBtn.addEventListener('click', () => toggleCard(node));

    boardContainer.appendChild(node);
    cards.push(node);
  });
}

function toggleCard(card) {
  if (card.classList.contains('is-open')) {
    closeCard(card);
  } else {
    openCard(card);
  }
}

function openCard(card) {
  const expand = card.querySelector('.board-expand');
  const btn = card.querySelector('.expand-btn');
  card.classList.add('is-open');
  expand.hidden = false;
  requestAnimationFrame(() => {
    expand.style.maxHeight = `${expand.scrollHeight + 12}px`;
  });
  btn.textContent = 'Collapse';
  btn.setAttribute('aria-expanded', 'true');
}

function closeCard(card) {
  const expand = card.querySelector('.board-expand');
  const btn = card.querySelector('.expand-btn');
  expand.style.maxHeight = `${expand.scrollHeight}px`;
  requestAnimationFrame(() => {
    expand.style.maxHeight = '0px';
  });
  expand.addEventListener('transitionend', function handler() {
    if (!card.classList.contains('is-open')) expand.hidden = true;
    expand.removeEventListener('transitionend', handler);
  });
  card.classList.remove('is-open');
  btn.textContent = 'Expand';
  btn.setAttribute('aria-expanded', 'false');
}

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    modeButtons.forEach(button => {
      const active = button === btn;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    applyMode(currentMode);
  });
});

function applyMode(mode) {
  cards.forEach(card => {
    const tags = card.querySelector('.tag-row');
    const peek = card.querySelector('.peek-row');

    tags.style.display = 'flex';
    peek.style.display = 'block';

    if (mode === 'skim') {
      tags.style.display = 'none';
      peek.style.display = 'none';
      closeCard(card);
    } else if (mode === 'peek') {
      closeCard(card);
    } else if (mode === 'peruse') {
      closeCard(card);
      peek.style.display = 'block';
    } else if (mode === 'deep' || mode === 'all') {
      openCard(card);
    }
  });
}
