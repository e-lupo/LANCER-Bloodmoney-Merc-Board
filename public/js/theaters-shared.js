/**
 * Shared helpers for rendering flat (2D) operational theaters.
 * Used by both the admin editor and the client viewer.
 */

// Escape HTML to avoid injection when building markup from data
function theaterEscapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a flat theater's background + location markers into a viewport element.
 * @param {HTMLElement} viewport - the .theater-map-viewport container
 * @param {Object} theater - the theater object
 * @param {Object} opts - { selectedLocationId, onMarkerClick(loc), showLabels }
 */
function renderFlatTheater(viewport, theater, opts) {
  opts = opts || {};
  viewport.innerHTML = '';
  viewport.classList.remove('empty');

  if (!theater) {
    viewport.classList.add('empty');
    viewport.textContent = '> NO_THEATER_SELECTED_';
    return;
  }

  // Background image
  if (theater.backgroundImage) {
    const img = document.createElement('img');
    img.className = 'theater-map-image';
    img.src = '/theater-assets/' + encodeURIComponent(theater.backgroundImage);
    img.alt = theater.name || 'Theater';
    viewport.appendChild(img);
  }

  // Markers
  (theater.locations || []).forEach(loc => {
    // Only flat-positioned locations render here
    if (typeof loc.x !== 'number' || typeof loc.y !== 'number') return;

    const marker = document.createElement('div');
    marker.className = 'theater-marker';
    if (opts.selectedLocationId && loc.id === opts.selectedLocationId) {
      marker.classList.add('selected');
    }
    marker.style.left = (loc.x * 100) + '%';
    marker.style.top = (loc.y * 100) + '%';
    marker.dataset.locationId = loc.id;

    // Render the marker icon. When a color is set, tint the whole icon body
    // by using the emblem SVG as a CSS mask filled with that color. Without a
    // color, fall back to an inverted <img> so dark SVGs stay visible.
    const scale = Number(loc.iconScale) || 1;
    const size = 32 * scale;
    const iconUrl = '/emblems/' + encodeURIComponent(loc.icon || 'token--world.svg');

    let icon;
    if (loc.iconColor) {
      icon = document.createElement('span');
      icon.className = 'theater-marker-icon';
      icon.style.width = size + 'px';
      icon.style.height = size + 'px';
      icon.style.backgroundColor = loc.iconColor;
      const maskValue = "url('" + iconUrl + "') no-repeat center / contain";
      icon.style.webkitMask = maskValue;
      icon.style.mask = maskValue;
      // Subtle dark outline for contrast against light backgrounds
      icon.style.filter = 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.9))';
    } else {
      icon = document.createElement('img');
      icon.src = iconUrl;
      icon.alt = loc.name || 'Location';
      icon.style.width = size + 'px';
      icon.style.height = size + 'px';
    }
    marker.appendChild(icon);

    if (opts.showLabels !== false) {
      const label = document.createElement('div');
      label.className = 'theater-marker-label';
      label.textContent = loc.name || '';
      marker.appendChild(label);
    }

    if (typeof opts.onMarkerClick === 'function') {
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onMarkerClick(loc);
      });
    }

    viewport.appendChild(marker);
  });
}

/**
 * Convert a click event on the viewport into normalized [0,1] coordinates.
 * @param {HTMLElement} viewport
 * @param {MouseEvent} event
 * @returns {{x:number, y:number}}
 */
function viewportClickToNormalized(viewport, event) {
  const rect = viewport.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  };
}

// Expose on window for use by non-module scripts
window.TheaterShared = {
  escapeHtml: theaterEscapeHtml,
  renderFlatTheater,
  viewportClickToNormalized
};