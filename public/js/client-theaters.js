/**
 * Client-side Operational Theater viewer.
 * Read-only visualization of theaters + locations, with the SAME job
 * interactions as the rest of the app (reuses shared-handlers openJobDetails).
 */

let theaterState = {
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

// Fetch all required data, then render
Promise.all([
  fetch('/api/theaters').then(r => r.json()),
  fetch('/api/jobs').then(r => r.json()),
  fetch('/api/factions').then(r => r.json()),
  fetch('/api/pilots').then(r => r.json()),
  fetch('/api/voting-periods').then(r => r.json())
]).then(([theaters, jobs, factions, pilots, votingPeriodsData]) => {
  theaterState.theaters = theaters || [];
  theaterState.jobs = jobs || [];
  theaterState.factions = factions || [];
  theaterState.pilots = pilots || [];
  updateOngoingVotingPeriod(votingPeriodsData);

  // Auto-select first theater if any
  if (theaterState.theaters.length > 0) {
    theaterState.selectedTheaterId = theaterState.theaters[0].id;
  }
  renderTheaterList();
  renderSelectedTheater();
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
    theaterState.theaters = data.theaters;

    // If selected theater was deleted, reset selection
    if (!theaterState.theaters.some(t => t.id === theaterState.selectedTheaterId)) {
      theaterState.selectedTheaterId = theaterState.theaters[0]
        ? theaterState.theaters[0].id
        : null;
      theaterState.selectedLocationId = null;
    }
    renderTheaterList();
    renderSelectedTheater();
  }
}

function handleJobsUpdate(data) {
  if (data && Array.isArray(data.jobs)) {
    theaterState.jobs = data.jobs;
    // Re-render assigned missions panel if a location is open
    if (theaterState.selectedLocationId) {
      renderLocationPanel(getSelectedLocation());
    }
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
  if (!list) return;

  if (theaterState.theaters.length === 0) {
    list.innerHTML = '<span style="opacity:0.6;">> NO_THEATERS_DEFINED_</span>';
    return;
  }

  list.innerHTML = '';
  theaterState.theaters.forEach(theater => {
    const item = document.createElement('div');
    item.className = 'theater-list-item' +
      (theater.id === theaterState.selectedTheaterId ? ' active' : '');
    item.textContent = theater.name;
    item.addEventListener('click', () => {
      theaterState.selectedTheaterId = theater.id;
      theaterState.selectedLocationId = null;
      renderTheaterList();
      renderSelectedTheater();
    });
    list.appendChild(item);
  });
}

function renderSelectedTheater() {
  const viewport = document.getElementById('theater-viewport');
  const panel = document.getElementById('theater-location-panel');
  if (!viewport) return;

  const theater = getSelectedTheater();

  // Hide panel when re-rendering a theater
  if (panel) panel.style.display = 'none';

  // Planet-type theaters are handled in Iteration 2; show a notice for now
  if (theater && theater.type === 'planet') {
    viewport.innerHTML = '';
    viewport.classList.add('empty');
    viewport.textContent = '> PLANET_THEATER_RENDERING_PENDING_(ITER_2)_';
    return;
  }

  window.TheaterShared.renderFlatTheater(viewport, theater, {
    selectedLocationId: theaterState.selectedLocationId,
    onMarkerClick: (loc) => {
      theaterState.selectedLocationId = loc.id;
      renderSelectedTheater();
      renderLocationPanel(loc);
    }
  });
}

function renderLocationPanel(loc) {
  const panel = document.getElementById('theater-location-panel');
  const nameEl = document.getElementById('theater-location-name');
  const descEl = document.getElementById('theater-location-description');
  const jobsEl = document.getElementById('theater-assigned-jobs');
  const childContainer = document.getElementById('theater-child-link-container');
  const childBtn = document.getElementById('theater-child-link-btn');
  if (!panel || !loc) return;

  panel.style.display = 'block';
  nameEl.textContent = '> ' + (loc.name || '');
  descEl.textContent = loc.description || '';

  // Drill-down link to a child theater (Iter 2 concept, works for flat too)
  if (loc.childTheaterId && theaterState.theaters.some(t => t.id === loc.childTheaterId)) {
    childContainer.style.display = 'block';
    childBtn.onclick = () => {
      theaterState.selectedTheaterId = loc.childTheaterId;
      theaterState.selectedLocationId = null;
      renderTheaterList();
      renderSelectedTheater();
    };
  } else {
    childContainer.style.display = 'none';
  }

  // Assigned missions — same data + same interactions as job board
  const assignedJobs = (loc.assignedJobIds || [])
    .map(id => theaterState.jobs.find(j => j.id === id))
    .filter(Boolean);

  if (assignedJobs.length === 0) {
    jobsEl.innerHTML = '<span style="opacity:0.6;">> NO_MISSIONS_ASSIGNED_</span>';
    return;
  }

  jobsEl.innerHTML = '';
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
    jobsEl.appendChild(item);
  });
}