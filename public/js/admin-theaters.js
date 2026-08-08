/**
 * Admin-side Operational Theater editor.
 * Handles theater CRUD, background upload, click-to-place locations,
 * drag-to-reposition, icon/color/scale, and job assignment.
 */

const AdminTheaters = {
  theaters: [],
  jobs: [],
  selectedTheaterId: null,
  editingLocationId: null,   // null = creating a new location
  placingMode: false,
  pendingIcon: 'token--world.svg',
  pendingCoords: null        // {x, y} for a newly placed (unsaved) location
};

// ==================== Data loading ====================

function theaterAdminInit() {
  Promise.all([
    fetch('/api/theaters').then(r => r.json()),
    fetch('/api/jobs').then(r => r.json())
  ]).then(([theaters, jobs]) => {
    AdminTheaters.theaters = theaters || [];
    AdminTheaters.jobs = jobs || [];
    if (AdminTheaters.theaters.length > 0 && !AdminTheaters.selectedTheaterId) {
      AdminTheaters.selectedTheaterId = AdminTheaters.theaters[0].id;
    }
    theaterAdminRenderList();
    theaterAdminRenderEditor();
  });
}

// SSE handler
function handleTheatersUpdate(data) {
  if (data && Array.isArray(data.theaters)) {
    AdminTheaters.theaters = data.theaters;
    if (!AdminTheaters.theaters.some(t => t.id === AdminTheaters.selectedTheaterId)) {
      AdminTheaters.selectedTheaterId = AdminTheaters.theaters[0]
        ? AdminTheaters.theaters[0].id
        : null;
    }
    theaterAdminRenderList();
    theaterAdminRenderEditor();
  }
}

function theaterAdminGetSelected() {
  return AdminTheaters.theaters.find(t => t.id === AdminTheaters.selectedTheaterId) || null;
}

// ==================== Theater CRUD ====================

function theaterAdminCreate() {
  const name = prompt('Theater name:');
  if (!name) return;
  fetch('/api/theaters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: 'flat' })
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        AdminTheaters.selectedTheaterId = res.theater.id;
      } else {
        alert(res.message || 'Failed to create theater');
      }
    });
}

function theaterAdminSaveDetails() {
  const theater = theaterAdminGetSelected();
  if (!theater) return;
  const body = {
    name: document.getElementById('admin-theater-name').value,
    description: document.getElementById('admin-theater-description').value,
    type: document.getElementById('admin-theater-type').value,
    active: document.getElementById('admin-theater-active').checked,
    backgroundImage: theater.backgroundImage,
    textureImage: theater.textureImage
  };
  fetch('/api/theaters/' + theater.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(res => {
      if (!res.success) alert(res.message || 'Failed to save theater');
    });
}

function theaterAdminDelete() {
  const theater = theaterAdminGetSelected();
  if (!theater) return;
  if (!confirm('Delete theater "' + theater.name + '"?')) return;
  fetch('/api/theaters/' + theater.id, { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (!res.success) alert(res.message || 'Failed to delete theater');
    });
}

function theaterAdminUploadBackground() {
  const theater = theaterAdminGetSelected();
  if (!theater) return;
  const fileInput = document.getElementById('admin-theater-bg-file');
  const status = document.getElementById('admin-theater-bg-status');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Select an image file first');
    return;
  }
  const formData = new FormData();
  formData.append('myFile', fileInput.files[0]);
  status.textContent = ' Uploading...';

  fetch('/upload/theater-background', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(res => {
      if (!res.success) {
        status.textContent = ' Upload failed';
        alert(res.message || 'Upload failed');
        return;
      }
      status.textContent = ' Uploaded.';
      fileInput.value = '';
      // Save the new background onto the theater
      return fetch('/api/theaters/' + theater.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: theater.name,
          description: theater.description,
          type: theater.type,
          active: theater.active !== false,
          backgroundImage: res.backgroundImage,
          textureImage: theater.textureImage
        })
      }).then(() => theaterAdminRenderGallery());
    })
    .catch(() => {
      status.textContent = ' Upload error';
    });
}

// ==================== Background gallery ====================

// Fetch and render the gallery of previously uploaded background images.
function theaterAdminRenderGallery() {
  const gallery = document.getElementById('admin-theater-bg-gallery');
  if (!gallery) return;

  fetch('/api/theater-assets')
    .then(r => r.json())
    .then(assets => {
      gallery.innerHTML = '';
      if (!Array.isArray(assets) || assets.length === 0) {
        gallery.innerHTML = '<span style="color:#b0b0b0;">No uploaded images yet.</span>';
        return;
      }

      const theater = theaterAdminGetSelected();
      const currentBg = theater ? theater.backgroundImage : null;

      assets.forEach(asset => {
        const cell = document.createElement('div');
        cell.className = 'theater-bg-thumb' +
          (asset.filename === currentBg ? ' selected' : '');

        const img = document.createElement('img');
        img.src = '/theater-assets/' + encodeURIComponent(asset.filename);
        img.alt = asset.filename;
        img.title = 'Use this background';
        img.onclick = () => theaterAdminSelectBackground(asset.filename);
        cell.appendChild(img);

        // Delete button — deleting an in-use image clears it from its theater.
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'theater-bg-thumb-delete';
        del.textContent = '✕';
        del.title = asset.inUse
          ? 'In use — deleting will remove it from its theater'
          : 'Delete image';
        del.onclick = (e) => {
          e.stopPropagation();
          theaterAdminDeleteBackground(asset.filename, asset.inUse);
        };
        cell.appendChild(del);

        gallery.appendChild(cell);
      });
    })
    .catch(() => {
      gallery.innerHTML = '<span style="color:#b0b0b0;">Failed to load images.</span>';
    });
}

// Set the selected theater's background to an existing uploaded image.
function theaterAdminSelectBackground(filename) {
  const theater = theaterAdminGetSelected();
  if (!theater) return;
  fetch('/api/theaters/' + theater.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: theater.name,
      description: theater.description,
      type: theater.type,
      active: theater.active !== false,
      backgroundImage: filename,
      textureImage: theater.textureImage
    })
  })
    .then(r => r.json())
    .then(res => {
      if (!res.success) alert(res.message || 'Failed to set background');
      // SSE will refresh the editor + gallery highlight
    });
}

// Delete an uploaded background image. If it's in use, deleting also clears
// it from the theater(s) that reference it (handled server-side).
function theaterAdminDeleteBackground(filename, inUse) {
  const msg = inUse
    ? 'This image is in use by a theater. Deleting will remove it from that theater. Continue?'
    : 'Delete this image? This cannot be undone.';
  if (!confirm(msg)) return;
  fetch('/api/theater-assets/' + encodeURIComponent(filename), { method: 'DELETE' })
    .then(r => r.json())
    .then(res => {
      if (!res.success) {
        alert(res.message || 'Failed to delete image');
        return;
      }
      // Re-fetch theaters from the server so ALL local state (theater objects
      // and the marker-click closures created during render) uses fresh data
      // with the deleted background cleared. This prevents a stale cached
      // background from reappearing when a location marker is later clicked.
      fetch('/api/theaters')
        .then(r => r.json())
        .then(theaters => {
          AdminTheaters.theaters = theaters || [];
          if (!AdminTheaters.theaters.some(t => t.id === AdminTheaters.selectedTheaterId)) {
            AdminTheaters.selectedTheaterId = AdminTheaters.theaters[0]
              ? AdminTheaters.theaters[0].id
              : null;
          }
          theaterAdminRenderList();
          theaterAdminRenderEditor();
          theaterAdminRenderGallery();
        });
    });
}

// ==================== Rendering ====================

function theaterAdminRenderList() {
  const list = document.getElementById('admin-theater-list');
  if (!list) return;
  list.innerHTML = '';
  if (AdminTheaters.theaters.length === 0) {
    list.innerHTML = '<span style="opacity:0.6;">No theaters yet.</span>';
  }
  AdminTheaters.theaters.forEach(theater => {
    const item = document.createElement('div');
    item.className = 'theater-list-item' +
      (theater.id === AdminTheaters.selectedTheaterId ? ' active' : '') +
      (theater.active === false ? ' theater-inactive' : '');
    // Mark inactive (player-hidden) theaters for GM clarity
    item.textContent = theater.active === false
      ? theater.name + ' (inactive)'
      : theater.name;
    item.onclick = () => {
      AdminTheaters.selectedTheaterId = theater.id;
      AdminTheaters.placingMode = false;
      theaterAdminCloseLocationEditor();
      theaterAdminRenderList();
      theaterAdminRenderEditor();
    };
    list.appendChild(item);
  });
}

function theaterAdminRenderEditor() {
  const editor = document.getElementById('admin-theater-editor');
  const viewport = document.getElementById('admin-theater-viewport');
  const theater = theaterAdminGetSelected();

  if (!editor || !viewport) return;

  if (!theater) {
    editor.style.display = 'none';
    return;
  }

  editor.style.display = 'block';
  document.getElementById('admin-theater-name').value = theater.name || '';
  document.getElementById('admin-theater-description').value = theater.description || '';
  document.getElementById('admin-theater-type').value = theater.type || 'flat';
  document.getElementById('admin-theater-active').checked = theater.active !== false;

  // Render the uploaded-image gallery (highlights the current background)
  theaterAdminRenderGallery();

  // Render map + markers with drag support
  window.TheaterShared.renderFlatTheater(viewport, theater, {
    onMarkerClick: (loc) => theaterAdminOpenLocationEditor(loc)
  });

  // Enable dragging of existing markers
  theaterAdminEnableMarkerDrag(viewport, theater);

  // Placement mode click handler
  viewport.classList.toggle('placing', AdminTheaters.placingMode);
  viewport.onclick = (e) => {
    if (!AdminTheaters.placingMode) return;
    // Ignore clicks that land on an existing marker
    if (e.target.closest('.theater-marker')) return;
    const coords = window.TheaterShared.viewportClickToNormalized(viewport, e);
    AdminTheaters.pendingCoords = coords;
    AdminTheaters.placingMode = false;
    viewport.classList.remove('placing');
    theaterAdminOpenLocationEditor(null);
  };
}

function theaterAdminEnableMarkerDrag(viewport, theater) {
  const markers = viewport.querySelectorAll('.theater-marker');
  markers.forEach(marker => {
    let dragging = false;

    marker.addEventListener('mousedown', (e) => {
      // left button only
      if (e.button !== 0) return;
      dragging = true;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const coords = window.TheaterShared.viewportClickToNormalized(viewport, e);
      marker.style.left = (coords.x * 100) + '%';
      marker.style.top = (coords.y * 100) + '%';
    });

    document.addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;
      const coords = window.TheaterShared.viewportClickToNormalized(viewport, e);
      const locId = marker.dataset.locationId;
      const loc = (theater.locations || []).find(l => l.id === locId);
      if (loc) {
        theaterAdminPersistLocation(theater.id, {
          ...loc,
          x: coords.x,
          y: coords.y
        });
      }
    });
  });
}

// ==================== Location editing ====================

function theaterAdminTogglePlacement() {
  AdminTheaters.placingMode = !AdminTheaters.placingMode;
  const hint = document.getElementById('admin-place-hint');
  hint.textContent = AdminTheaters.placingMode
    ? 'Click on the map to place a location.'
    : '';
  const viewport = document.getElementById('admin-theater-viewport');
  if (viewport) viewport.classList.toggle('placing', AdminTheaters.placingMode);
}

function theaterAdminSelectIcon(icon) {
  AdminTheaters.pendingIcon = icon;
  document.querySelectorAll('#admin-loc-icon-grid .theater-icon-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.icon === icon);
  });
}

function theaterAdminOpenLocationEditor(loc) {
  const panel = document.getElementById('admin-location-editor');
  if (!panel) return;
  panel.style.display = 'block';

  AdminTheaters.editingLocationId = loc ? loc.id : null;

  document.getElementById('admin-loc-name').value = loc ? (loc.name || '') : '';
  document.getElementById('admin-loc-description').value = loc ? (loc.description || '') : '';
  document.getElementById('admin-loc-color').value = loc ? (loc.iconColor || '#e0e0e0') : '#e0e0e0';
  document.getElementById('admin-loc-scale').value = loc ? (loc.iconScale || 1) : 1;
  AdminTheaters.pendingIcon = loc ? (loc.icon || 'token--world.svg') : 'token--world.svg';
  theaterAdminSelectIcon(AdminTheaters.pendingIcon);

  // Populate child-theater dropdown (exclude self)
  const childSelect = document.getElementById('admin-loc-child-theater');
  const currentId = AdminTheaters.selectedTheaterId;
  childSelect.innerHTML = '<option value="">(none)</option>';
  AdminTheaters.theaters
    .filter(t => t.id !== currentId)
    .forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      childSelect.appendChild(opt);
    });
  childSelect.value = loc && loc.childTheaterId ? loc.childTheaterId : '';

  // Populate job checklist
  const jobsEl = document.getElementById('admin-loc-jobs');
  const assigned = new Set(loc ? (loc.assignedJobIds || []) : []);
  jobsEl.innerHTML = '';
  AdminTheaters.jobs.forEach(job => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = job.id;
    cb.checked = assigned.has(job.id);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(
      ' ' + job.name + ' [' + (job.state || '') + ']'
    ));
    jobsEl.appendChild(label);
  });
}

function theaterAdminCloseLocationEditor() {
  const panel = document.getElementById('admin-location-editor');
  if (panel) panel.style.display = 'none';
  AdminTheaters.editingLocationId = null;
  AdminTheaters.pendingCoords = null;
}

function theaterAdminGatherLocationBody(existingLoc) {
  const assignedJobIds = Array.from(
    document.querySelectorAll('#admin-loc-jobs input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const childVal = document.getElementById('admin-loc-child-theater').value;

  // Determine coordinates: pending (new) or from existing location
  let x = existingLoc ? existingLoc.x : null;
  let y = existingLoc ? existingLoc.y : null;
  if (AdminTheaters.pendingCoords) {
    x = AdminTheaters.pendingCoords.x;
    y = AdminTheaters.pendingCoords.y;
  }

  return {
    name: document.getElementById('admin-loc-name').value,
    description: document.getElementById('admin-loc-description').value,
    icon: AdminTheaters.pendingIcon,
    iconColor: document.getElementById('admin-loc-color').value,
    iconScale: parseFloat(document.getElementById('admin-loc-scale').value) || 1,
    x: x,
    y: y,
    assignedJobIds: assignedJobIds,
    childTheaterId: childVal || null
  };
}

function theaterAdminSaveLocation() {
  const theater = theaterAdminGetSelected();
  if (!theater) return;

  const existingLoc = AdminTheaters.editingLocationId
    ? (theater.locations || []).find(l => l.id === AdminTheaters.editingLocationId)
    : null;

  const body = theaterAdminGatherLocationBody(existingLoc);

  if (!body.name) {
    alert('Location name is required');
    return;
  }
  if (body.x === null || body.y === null) {
    alert('Place the location on the map first');
    return;
  }

  const isUpdate = !!AdminTheaters.editingLocationId;
  const url = isUpdate
    ? '/api/theaters/' + theater.id + '/locations/' + AdminTheaters.editingLocationId
    : '/api/theaters/' + theater.id + '/locations';

  fetch(url, {
    method: isUpdate ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        theaterAdminCloseLocationEditor();
      } else {
        alert(res.message || 'Failed to save location');
      }
    });
}

// Persist a location without opening the editor (used by drag)
function theaterAdminPersistLocation(theaterId, loc) {
  fetch('/api/theaters/' + theaterId + '/locations/' + loc.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: loc.name,
      description: loc.description,
      icon: loc.icon,
      iconColor: loc.iconColor,
      iconScale: loc.iconScale,
      x: loc.x,
      y: loc.y,
      assignedJobIds: loc.assignedJobIds || [],
      childTheaterId: loc.childTheaterId || null
    })
  })
    .then(r => r.json())
    .then(res => {
      if (!res.success) alert(res.message || 'Failed to move location');
    });
}

function theaterAdminDeleteLocation() {
  const theater = theaterAdminGetSelected();
  if (!theater || !AdminTheaters.editingLocationId) return;
  if (!confirm('Delete this location?')) return;
  fetch('/api/theaters/' + theater.id + '/locations/' + AdminTheaters.editingLocationId, {
    method: 'DELETE'
  })
    .then(r => r.json())
    .then(res => {
      if (res.success) {
        theaterAdminCloseLocationEditor();
      } else {
        alert(res.message || 'Failed to delete location');
      }
    });
}

// Initialize once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', theaterAdminInit);
} else {
  theaterAdminInit();
}