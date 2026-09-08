/**
 * Client-side Operational Theater viewer.
 * Read-only visualization of theaters + locations, with the SAME job
 * interactions as the rest of the app (reuses shared-handlers openJobDetails).
 */

let theaterState = {
  allTheaters: [],
  theaters: [],
  jobs: [],
  factions: [],
  pilots: [],
  ongoingVotingPeriod: null,
  selectedTheaterId: null,
  selectedLocationId: null
};

// Voting modal selection state (mirrors the job board)
let selectedVotingJobId = null;
let selectedVotingPilotId = null;
let lastRenderedTheaterId = null;

function refreshVisibleTheaters() {
  theaterState.theaters = window.TheaterShared.filterVisibleTheaters(theaterState.allTheaters, theaterState.jobs);
}

// If the selected theater dropped out of the visible set (deleted, or its
// active-job override expired), fall back to the first available one.
// Preserve an intentional null selection when the user collapsed the view.
function reconcileSelectedTheater() {
  if (theaterState.selectedTheaterId &&
      !theaterState.theaters.some(t => t.id === theaterState.selectedTheaterId)) {
    theaterState.selectedTheaterId = theaterState.theaters[0]
      ? theaterState.theaters[0].id
      : null;
    theaterState.selectedLocationId = null;
  }
}

function renderTheaterView() {
  renderTheaterList();
  renderSelectedTheater();
}

function selectTheater(theaterId) {
  theaterState.selectedTheaterId = theaterId;
  theaterState.selectedLocationId = null;
  renderTheaterView();
}

// Fetch all required data, then render
Promise.all([
  fetch('/api/theaters').then(r => r.json()),
  fetch('/api/jobs').then(r => r.json()),
  fetch('/api/factions').then(r => r.json()),
  fetch('/api/pilots').then(r => r.json()),
  fetch('/api/voting-periods').then(r => r.json())
]).then(([theaters, jobs, factions, pilots, votingPeriodsData]) => {
  theaterState.jobs = (jobs || []).filter(job => job.state === 'Active');
  theaterState.allTheaters = theaters || [];
  refreshVisibleTheaters();
  theaterState.factions = factions || [];
  theaterState.pilots = pilots || [];
  updateOngoingVotingPeriod(votingPeriodsData);

  // Auto-select first theater if any
  if (theaterState.theaters.length > 0) {
    theaterState.selectedTheaterId = theaterState.theaters[0].id;
  }
  renderTheaterView();
});

// ==================== Voting integration ====================
// The operational theater treats jobs as the SAME data with the SAME
// interactions as the job board, including voting. We expose the identical
// voting context/functions that shared-handlers.js expects, so the job
// details modal shows the VOTES section and a working [CAST_VOTE] button.

function updateOngoingVotingPeriod(votingPeriodsData) {
  theaterState.ongoingVotingPeriod =
    (votingPeriodsData && Array.isArray(votingPeriodsData.periods))
      ? votingPeriodsData.periods.find(p => p.state === 'Ongoing') || null
      : null;
}

function isVotingActive() {
  const period = theaterState.ongoingVotingPeriod;
  if (!period) return false;
  if (period.endTime === null) return true;
  return new Date() <= new Date(period.endTime);
}

function getVoteCount(jobId) {
  const period = theaterState.ongoingVotingPeriod;
  if (!period) return 0;
  const jobVote = period.jobVotes.find(jv => jv.jobId === jobId);
  return jobVote ? jobVote.votes.length : 0;
}

// Expose the voting context expected by shared-handlers.js
Object.defineProperty(window, 'currentOngoingVotingPeriod', {
  get: () => theaterState.ongoingVotingPeriod,
  configurable: true
});
window.isVotingActive = isVotingActive;
window.getVoteCount = getVoteCount;
window.openVotingModal = openVotingModal;

// Open the pilot-selection voting modal (identical behavior to job board)
function openVotingModal(jobId) {
  selectedVotingJobId = jobId;
  selectedVotingPilotId = null;

  const modal = document.getElementById('voting-modal');
  const pilotsList = document.getElementById('voting-pilots-list');
  const castVoteBtn = document.getElementById('cast-vote-btn');
  const voteWarning = document.getElementById('vote-warning');
  if (!modal) return;

  castVoteBtn.disabled = true;
  voteWarning.style.display = 'none';

  const activePilots = theaterState.pilots.filter(p => p.active);
  const inactivePilots = theaterState.pilots.filter(p => !p.active);
  const sortedPilots = [...activePilots, ...inactivePilots];

  pilotsList.innerHTML = sortedPilots.map(pilot => {
    const activeClass = pilot.active ? '' : 'pilot-inactive';
    return `
      <div class="pilot-item ${activeClass}" data-pilot-id="${pilot.id}" onclick="selectVotingPilot('${pilot.id}')">
        <span class="pilot-ll">LL${pilot.ll}</span>
        <span class="pilot-name">${pilot.name} "${pilot.callsign}"</span>
      </div>
    `;
  }).join('');

  modal.classList.add('active');
}

function closeVotingModal() {
  const modal = document.getElementById('voting-modal');
  if (modal) modal.classList.remove('active');
  selectedVotingJobId = null;
  selectedVotingPilotId = null;
}

function selectVotingPilot(pilotId) {
  selectedVotingPilotId = pilotId;
  const castVoteBtn = document.getElementById('cast-vote-btn');
  const voteWarning = document.getElementById('vote-warning');
  castVoteBtn.disabled = false;

  document.querySelectorAll('.pilot-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.pilotId === pilotId);
  });

  // Warn if the pilot already voted for a different job
  let hasVoted = false;
  const period = theaterState.ongoingVotingPeriod;
  if (period) {
    for (const jobVote of period.jobVotes) {
      if (jobVote.votes.includes(pilotId) && jobVote.jobId !== selectedVotingJobId) {
        hasVoted = true;
        break;
      }
    }
  }
  if (hasVoted) {
    voteWarning.textContent = "THIS PILOT'S PREVIOUS VOTE WILL BE OVERWRITTEN";
    voteWarning.style.display = 'block';
  } else {
    voteWarning.style.display = 'none';
  }
}

function confirmVote() {
  const period = theaterState.ongoingVotingPeriod;
  if (!selectedVotingJobId || !selectedVotingPilotId || !period) return;

  const castVoteBtn = document.getElementById('cast-vote-btn');
  castVoteBtn.disabled = true;

  fetch(`/api/voting-periods/${period.id}/cast-vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pilotId: selectedVotingPilotId, jobId: selectedVotingJobId })
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeVotingModal();
      } else {
        alert('Error casting vote: ' + (data.message || 'Unknown error'));
        castVoteBtn.disabled = false;
      }
    })
    .catch(() => {
      alert('Error casting vote. Please try again.');
      castVoteBtn.disabled = false;
    });
}

// Expose voting modal functions for inline onclick handlers
window.closeVotingModal = closeVotingModal;
window.selectVotingPilot = selectVotingPilot;
window.confirmVote = confirmVote;

// Close modals when clicking the overlay background
initializeModalHandlers();

// Keep voting data fresh via SSE
function handleVotingPeriodsUpdate(data) {
  if (data && Array.isArray(data.periods)) {
    updateOngoingVotingPeriod(data);
  }
}

// SSE handlers (invoked by sse-client.js)
function handleTheatersUpdate(data) {
  if (data && Array.isArray(data.theaters)) {
    // The SSE payload contains ALL theaters. Apply the same player visibility
    // rules as the API, including the active-job override for hidden theaters.
    theaterState.allTheaters = data.theaters;
    refreshVisibleTheaters();
    reconcileSelectedTheater();
    renderTheaterView();
  }
}

function handleJobsUpdate(data) {
  if (data && Array.isArray(data.jobs)) {
    theaterState.jobs = data.jobs.filter(job => job.state === 'Active');
    // A job becoming Active can make its otherwise-hidden location visible.
    // Re-fetch the role-filtered theater data so that transition appears
    // immediately even when the initial client payload omitted the location.
    fetch('/api/theaters')
      .then(response => response.json())
      .then(theaters => {
        theaterState.allTheaters = theaters || [];
        refreshVisibleTheaters();
        reconcileSelectedTheater();
        renderTheaterView();
      });
  }
}

function handleFactionsUpdate(data) {
  if (data && Array.isArray(data.factions)) {
    theaterState.factions = data.factions;
  }
}

// ==================== Rendering ====================

function getSelectedTheater() {
  return theaterState.theaters.find(t => t.id === theaterState.selectedTheaterId) || null;
}

function getSelectedLocation() {
  const theater = getSelectedTheater();
  if (!theater) return null;
  return (theater.locations || []).find(l => l.id === theaterState.selectedLocationId) || null;
}

function renderTheaterList() {
  const list = document.getElementById('theater-list');
  const count = document.getElementById('theaters-count');
  if (!list) return;
  list.innerHTML = '';
  if (count) count.textContent = theaterState.theaters.length;

  if (theaterState.theaters.length === 0) {
    list.innerHTML = '<div class="client-theaters-empty">> NO_THEATERS_AVAILABLE_</div>';
    return;
  }

  theaterState.theaters.forEach(theater => {
    const card = document.createElement('article');
    const isSelected = theater.id === theaterState.selectedTheaterId;
    card.className = 'client-theater-card' +
      (isSelected ? ' active' : '') +
      (theaterState.selectedTheaterId && !isSelected ? ' subdued' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', String(isSelected));

    const title = document.createElement('h2');
    title.textContent = '> ' + theater.name;
    card.appendChild(title);

    const galacticPos = document.createElement('div');
    galacticPos.className = 'client-theater-galactic-pos';
    galacticPos.textContent = theater.galacticPos ? '> GALACTIC_POS: ' + theater.galacticPos : '';
    card.appendChild(galacticPos);

    const body = document.createElement('div');
    body.className = 'client-theater-card-body';
    const divider = document.createElement('div');
    divider.className = 'client-theater-divider';
    body.appendChild(divider);
    const descriptionHeading = document.createElement('div');
    descriptionHeading.className = 'client-theater-field-label';
    descriptionHeading.textContent = 'DESCRIPTION:';
    body.appendChild(descriptionHeading);
    const description = document.createElement('p');
    description.className = 'client-theater-description';
    description.textContent = theater.description || 'NO_DATA';
    body.appendChild(description);
    const heading = document.createElement('div');
    heading.className = 'client-theater-field-label';
    heading.textContent = 'LOCATIONS:';
    body.appendChild(heading);
    body.appendChild(buildLocationList(theater, true));
    card.appendChild(body);

    const toggleTheater = () => {
      selectTheater(isSelected ? null : theater.id);
    };
    card.addEventListener('click', toggleTheater);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleTheater();
      }
    });
    list.appendChild(card);
  });
}

function getActiveJobsForLocation(loc) {
  return (loc.assignedJobIds || [])
    .map(id => theaterState.jobs.find(job => job.id === id))
    .filter(Boolean);
}

function buildLocationList(theater, interactive) {
  const list = document.createElement('div');
  list.className = 'client-theater-location-list';
  const locations = theater.locations || [];
  if (locations.length === 0) {
    list.innerHTML = '<span class="client-theater-muted">> NO_LOCATIONS_</span>';
    return list;
  }
  locations.forEach(loc => {
    const row = document.createElement(interactive ? 'button' : 'div');
    row.className = 'client-theater-location-row';
    row.textContent = '> ' + (loc.name || 'UNNAMED_LOCATION');
    const activeCount = getActiveJobsForLocation(loc).length;
    if (activeCount > 0) {
      row.textContent += ' (' + activeCount + ' active job' + (activeCount === 1 ? '' : 's') + ')';
    }
    if (interactive) {
      row.type = 'button';
      row.addEventListener('click', event => {
        event.stopPropagation();
        theaterState.selectedTheaterId = theater.id;
        renderTheaterList();
        selectLocation(loc.id);
      });
    }
    list.appendChild(row);
  });
  return list;
}

function selectLocation(locationId) {
  theaterState.selectedLocationId = locationId;
  renderSelectedTheater();
}

function showTheaterDetails() {
  if (!theaterState.selectedLocationId) return;
  theaterState.selectedLocationId = null;
  renderSelectedTheater();
}

function animateTheaterChange() {
  const workspace = document.querySelector('.client-theater-workspace');
  if (!workspace) return;
  workspace.classList.remove('switching-theater');
  void workspace.offsetWidth;
  workspace.classList.add('switching-theater');
}

function getTheaterPanelElements() {
  return {
    panel: document.getElementById('theater-location-panel'),
    name: document.getElementById('theater-location-name'),
    description: document.getElementById('theater-location-description'),
    listHeading: document.getElementById('theater-detail-list-heading'),
    list: document.getElementById('theater-assigned-jobs'),
    childContainer: document.getElementById('theater-child-link-container'),
    childButton: document.getElementById('theater-child-link-btn'),
    galacticPos: document.getElementById('theater-detail-galactic-pos'),
    backButton: document.getElementById('theater-back-btn')
  };
}

function renderPanelHeader(elements, item, showBackButton) {
  elements.panel.style.display = 'flex';
  elements.name.textContent = '> ' + (item.name || '');
  elements.description.textContent = item.description || 'NO_DATA';
  elements.galacticPos.textContent = item.galacticPos
    ? '> GALACTIC_POS: ' + item.galacticPos
    : '';
  elements.backButton.hidden = !showBackButton;
  elements.backButton.onclick = showBackButton ? showTheaterDetails : null;
}

function renderSelectedTheater() {
  const viewport = document.getElementById('theater-viewport');
  const section = document.getElementById('selected-theater-section');
  if (!viewport) return;

  const theater = getSelectedTheater();
  const theaterChanged = !!theater && !!lastRenderedTheaterId &&
    theater.id !== lastRenderedTheaterId;
  if (section) {
    section.classList.toggle('visible', !!theater);
    section.setAttribute('aria-hidden', String(!theater));
  }
  if (!theater) {
    lastRenderedTheaterId = null;
    viewport.innerHTML = '<span>> SELECT_OPERATIONAL_THEATER_</span>';
    viewport.classList.add('empty');
    return;
  }

  let selectedLocation = getSelectedLocation();
  if (theaterState.selectedLocationId && !selectedLocation) {
    theaterState.selectedLocationId = null;
    selectedLocation = null;
  }

  // Planet-type theaters are handled in Iteration 2; show a notice for now
  if (theater && theater.type === 'planet') {
    viewport.innerHTML = '';
    viewport.classList.add('empty');
    viewport.textContent = '> PLANET_THEATER_RENDERING_PENDING_(ITER_2)_';
    renderTheaterPanel(theater);
    if (theaterChanged) animateTheaterChange();
    lastRenderedTheaterId = theater.id;
    return;
  }

  window.TheaterShared.renderFlatTheater(viewport, theater, {
    selectedLocationId: theaterState.selectedLocationId,
    onMarkerClick: (loc) => {
      selectLocation(loc.id);
    }
  });
  // Marker clicks stop propagation in theaters-shared.js; any other map click
  // returns the detail card to the containing theater.
  viewport.onclick = showTheaterDetails;
  if (selectedLocation) {
    renderLocationPanel(selectedLocation);
  } else {
    renderTheaterPanel(theater);
  }
  if (theaterChanged) animateTheaterChange();
  lastRenderedTheaterId = theater.id;
}

function renderTheaterPanel(theater) {
  const elements = getTheaterPanelElements();
  if (!elements.panel || !theater) return;
  renderPanelHeader(elements, theater, false);
  elements.listHeading.textContent = 'LOCATIONS:';
  elements.childContainer.hidden = true;
  elements.list.innerHTML = '';
  elements.list.appendChild(buildLocationList(theater, true));
}

function renderLocationPanel(loc) {
  const elements = getTheaterPanelElements();
  if (!elements.panel || !loc) return;
  renderPanelHeader(elements, loc, true);
  elements.listHeading.textContent = 'ASSIGNED_MISSIONS:';

  // Drill-down link to a child theater (Iter 2 concept, works for flat too)
  if (loc.childTheaterId && theaterState.theaters.some(t => t.id === loc.childTheaterId)) {
    elements.childContainer.hidden = false;
    elements.childButton.onclick = () => selectTheater(loc.childTheaterId);
  } else {
    elements.childContainer.hidden = true;
    elements.childButton.onclick = null;
  }

  // Assigned missions — same data + same interactions as job board
  const assignedJobs = getActiveJobsForLocation(loc);

  if (assignedJobs.length === 0) {
    elements.list.innerHTML = '<span class="client-theater-muted">> NO_MISSIONS_ASSIGNED_</span>';
    return;
  }

  elements.list.innerHTML = '';
  assignedJobs.forEach(job => {
    const item = document.createElement('div');
    item.className = 'theater-assigned-job';
    const faction = theaterState.factions.find(f => f.id === job.factionId);
    const factionName = faction ? faction.title : 'NO_FACTION';
    item.textContent = '> ' + job.name + ' - ' + factionName + ' [' + (job.state || '') + ']';
    item.addEventListener('click', () => {
      // Reuse the identical job-details modal used across the app
      openJobDetails(job.id, theaterState.jobs, theaterState.factions);
    });
    elements.list.appendChild(item);
  });
}