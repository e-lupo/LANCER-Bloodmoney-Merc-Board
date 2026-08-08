const express = require('express');
const helpers = require('../../helpers');
const dataStore = require('../../models/dataStore');
const { requireAnyAuth, requireAdminAuth } = require('../../middleware/auth');
const { broadcastSSE } = require('../../lib/sseManager');

const router = express.Router();

// ==================== Validation helpers ====================

// Clamp a value to the [0, 1] range; returns null if not a finite number
function clampNormalized(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(1, Math.max(0, num));
}

// Validate and normalize theater-level data (name/description/type/images)
function validateTheaterData(body) {
  const nameValidation = helpers.validateRequiredString(body.name, 'Theater name');
  if (!nameValidation.valid) {
    return { valid: false, message: nameValidation.message };
  }

  const type = body.type === 'planet' ? 'planet' : 'flat';

  // Default to active (visible to players) unless explicitly set false
  const active = !(body.active === false || body.active === 'false');

  return {
    valid: true,
    name: nameValidation.value,
    description: (body.description || '').toString().trim(),
    type,
    active,
    backgroundImage: body.backgroundImage ? String(body.backgroundImage) : null,
    textureImage: body.textureImage ? String(body.textureImage) : null
  };
}

// Validate and normalize a single location's data.
// jobIds: Set of valid job IDs for assignedJobIds validation.
function validateLocationData(body, jobIds) {
  const nameValidation = helpers.validateRequiredString(body.name, 'Location name');
  if (!nameValidation.valid) {
    return { valid: false, message: nameValidation.message };
  }

  // Icon must be a safe emblem filename if provided
  let icon = body.icon ? String(body.icon) : '';
  if (icon && !helpers.isSafeEmblemFilename(icon)) {
    return { valid: false, message: 'Invalid location icon filename' };
  }

  // Validate assignedJobIds (all must exist in jobs)
  let assignedJobIds = [];
  if (body.assignedJobIds !== undefined) {
    try {
      assignedJobIds = Array.isArray(body.assignedJobIds)
        ? body.assignedJobIds
        : JSON.parse(body.assignedJobIds);
    } catch (e) {
      return { valid: false, message: 'Invalid assignedJobIds format' };
    }
    if (!Array.isArray(assignedJobIds)) {
      return { valid: false, message: 'assignedJobIds must be an array' };
    }
    for (const jobId of assignedJobIds) {
      if (!jobIds.has(jobId)) {
        return { valid: false, message: `Assigned job not found: ${jobId}` };
      }
    }
  }

  return {
    valid: true,
    name: nameValidation.value,
    description: (body.description || '').toString().trim(),
    icon: icon || 'token--world.svg',
    iconColor: body.iconColor ? String(body.iconColor) : '#e0e0e0',
    iconEdgeColor: body.iconEdgeColor ? String(body.iconEdgeColor) : '#000000',
    iconScale: Number.isFinite(Number(body.iconScale)) ? Number(body.iconScale) : 1,
    x: clampNormalized(body.x),
    y: clampNormalized(body.y),
    lat: Number.isFinite(Number(body.lat)) ? Number(body.lat) : null,
    lon: Number.isFinite(Number(body.lon)) ? Number(body.lon) : null,
    childTheaterId: body.childTheaterId ? String(body.childTheaterId) : null
  };
}

// ==================== Theater CRUD ====================

// GET theaters (any authenticated user).
// Admins see all theaters; clients only see active (visible) theaters.
router.get('/', requireAnyAuth, (req, res) => {
  const theaters = dataStore.readTheaters();
  const isAdmin = req.session && req.session.role === 'admin';
  if (isAdmin) {
    return res.json(theaters);
  }
  res.json(theaters.filter(t => t.active !== false));
});

// POST create theater (admin)
router.post('/', requireAdminAuth, (req, res) => {
  const validation = validateTheaterData(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  const theaters = dataStore.readTheaters();
  const newTheater = {
    id: helpers.generateId(),
    name: validation.name,
    description: validation.description,
    type: validation.type,
    active: validation.active,
    backgroundImage: validation.backgroundImage,
    textureImage: validation.textureImage,
    locations: []
  };
  theaters.push(newTheater);
  dataStore.writeTheaters(theaters);

  broadcastSSE('theaters', { action: 'create', theater: newTheater, theaters });
  res.json({ success: true, theater: newTheater });
});

// PUT update theater (admin)
router.put('/:id', requireAdminAuth, (req, res) => {
  const theaters = dataStore.readTheaters();
  const index = theaters.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Theater not found' });
  }

  const validation = validateTheaterData(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  theaters[index] = {
    ...theaters[index],
    name: validation.name,
    description: validation.description,
    type: validation.type,
    active: validation.active,
    backgroundImage: validation.backgroundImage,
    textureImage: validation.textureImage
  };
  dataStore.writeTheaters(theaters);

  broadcastSSE('theaters', { action: 'update', theater: theaters[index], theaters });
  res.json({ success: true, theater: theaters[index] });
});

// DELETE theater (admin)
router.delete('/:id', requireAdminAuth, (req, res) => {
  let theaters = dataStore.readTheaters();
  const exists = theaters.some(t => t.id === req.params.id);
  if (!exists) {
    return res.status(404).json({ success: false, message: 'Theater not found' });
  }

  theaters = theaters.filter(t => t.id !== req.params.id);

  // Clean up any childTheaterId references pointing to the deleted theater
  theaters.forEach(t => {
    (t.locations || []).forEach(loc => {
      if (loc.childTheaterId === req.params.id) {
        loc.childTheaterId = null;
      }
    });
  });

  dataStore.writeTheaters(theaters);
  broadcastSSE('theaters', { action: 'delete', theaterId: req.params.id, theaters });
  res.json({ success: true });
});

// ==================== Location CRUD ====================

// POST add location to theater (admin)
router.post('/:id/locations', requireAdminAuth, (req, res) => {
  const theaters = dataStore.readTheaters();
  const theater = theaters.find(t => t.id === req.params.id);
  if (!theater) {
    return res.status(404).json({ success: false, message: 'Theater not found' });
  }

  const jobIds = new Set(dataStore.readJobs().map(j => j.id));
  const validation = validateLocationData(req.body, jobIds);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  const newLocation = {
    id: helpers.generateId(),
    name: validation.name,
    description: validation.description,
    icon: validation.icon,
    iconColor: validation.iconColor,
    iconEdgeColor: validation.iconEdgeColor,
    iconScale: validation.iconScale,
    x: validation.x,
    y: validation.y,
    lat: validation.lat,
    lon: validation.lon,
    assignedJobIds: [],
    childTheaterId: validation.childTheaterId
  };

  // Re-validate assignedJobIds through the sanitized array
  if (Array.isArray(req.body.assignedJobIds) || typeof req.body.assignedJobIds === 'string') {
    try {
      const ids = Array.isArray(req.body.assignedJobIds)
        ? req.body.assignedJobIds
        : JSON.parse(req.body.assignedJobIds);
      newLocation.assignedJobIds = ids.filter(id => jobIds.has(id));
    } catch (e) {
      newLocation.assignedJobIds = [];
    }
  }

  if (!Array.isArray(theater.locations)) theater.locations = [];
  theater.locations.push(newLocation);
  dataStore.writeTheaters(theaters);

  broadcastSSE('theaters', { action: 'location-create', theater, theaters });
  res.json({ success: true, location: newLocation, theater });
});

// PUT update location (admin)
router.put('/:id/locations/:locId', requireAdminAuth, (req, res) => {
  const theaters = dataStore.readTheaters();
  const theater = theaters.find(t => t.id === req.params.id);
  if (!theater) {
    return res.status(404).json({ success: false, message: 'Theater not found' });
  }

  const locIndex = (theater.locations || []).findIndex(l => l.id === req.params.locId);
  if (locIndex === -1) {
    return res.status(404).json({ success: false, message: 'Location not found' });
  }

  const jobIds = new Set(dataStore.readJobs().map(j => j.id));
  const validation = validateLocationData(req.body, jobIds);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  // Prevent a location from linking to its own theater (basic cycle guard)
  let childTheaterId = validation.childTheaterId;
  if (childTheaterId === theater.id) {
    childTheaterId = null;
  }

  let assignedJobIds = theater.locations[locIndex].assignedJobIds || [];
  if (req.body.assignedJobIds !== undefined) {
    try {
      const ids = Array.isArray(req.body.assignedJobIds)
        ? req.body.assignedJobIds
        : JSON.parse(req.body.assignedJobIds);
      assignedJobIds = ids.filter(id => jobIds.has(id));
    } catch (e) {
      assignedJobIds = [];
    }
  }

  theater.locations[locIndex] = {
    ...theater.locations[locIndex],
    name: validation.name,
    description: validation.description,
    icon: validation.icon,
    iconColor: validation.iconColor,
    iconScale: validation.iconScale,
    x: validation.x,
    y: validation.y,
    lat: validation.lat,
    lon: validation.lon,
    assignedJobIds,
    childTheaterId
  };
  dataStore.writeTheaters(theaters);

  broadcastSSE('theaters', { action: 'location-update', theater, theaters });
  res.json({ success: true, location: theater.locations[locIndex], theater });
});

// DELETE location (admin)
router.delete('/:id/locations/:locId', requireAdminAuth, (req, res) => {
  const theaters = dataStore.readTheaters();
  const theater = theaters.find(t => t.id === req.params.id);
  if (!theater) {
    return res.status(404).json({ success: false, message: 'Theater not found' });
  }

  const before = (theater.locations || []).length;
  theater.locations = (theater.locations || []).filter(l => l.id !== req.params.locId);
  if (theater.locations.length === before) {
    return res.status(404).json({ success: false, message: 'Location not found' });
  }

  dataStore.writeTheaters(theaters);
  broadcastSSE('theaters', { action: 'location-delete', theater, theaters, locationId: req.params.locId });
  res.json({ success: true });
});

module.exports = router;