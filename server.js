const express = require('express');
const path = require('path');
const fs = require('fs');
const helpers = require('./helpers');

const app = express();
const PORT = process.env.PORT || 3000;

// SSE client management
const sseClients = new Set();

// Constants
const PASSWORDS = {
  CLIENT: 'IMHOTEP',
  ADMIN: 'TARASQUE'
};

const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: new Set(['image/png', 'image/jpeg', 'image/bmp'])
};

const BASE_MODULES = {
  CORE_COUNT: 3,
  MAJOR_COUNT: 6,
  MINOR_COUNT: 6,
  TOTAL_COUNT: 15
};

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/emblems', express.static('logo_art'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Data file paths
const DATA_FILE = path.join(__dirname, 'data', 'jobs.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const MANNA_FILE = path.join(__dirname, 'data', 'manna.json');
const BASE_FILE = path.join(__dirname, 'data', 'base.json');
const FACTIONS_FILE = path.join(__dirname, 'data', 'factions.json');
const PILOTS_FILE = path.join(__dirname, 'data', 'pilots.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize settings file with default data if it doesn't exist
function initializeSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaultSettings = {
      ...DEFAULT_SETTINGS,
      unt: '01/01/5025',
      currentGalacticPos: 'SKAER-5'
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
  }
}

// Initialize data file with dummy data if it doesn't exist
function initializeData() {
  if (!fs.existsSync(DATA_FILE)) {
    const dummyJobs = [
      {
        id: helpers.generateId(),
        name: 'Lorem Ipsum Dolorem',
        rank: 2,
        jobType: 'Finibus bonorum',
        description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        clientBrief: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
        currencyPay: '150m',
        additionalPay: 'Duis aute irure dolor in reprehenderit',
        emblem: 'birds.svg',
        state: 'Active',
        factionId: ''
      },
      {
        id: helpers.generateId(),
        name: 'Sit Amet Consectetur',
        rank: 1,
        jobType: 'Malorum extrema',
        description: 'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
        clientBrief: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
        currencyPay: '75m',
        additionalPay: 'Totam rem aperiam',
        emblem: 'sun.svg',
        state: 'Active',
        factionId: ''
      },
      {
        id: helpers.generateId(),
        name: 'Tempor Incididunt',
        rank: 3,
        jobType: 'Ratione voluptatem',
        description: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores.',
        clientBrief: 'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.',
        currencyPay: '250m',
        additionalPay: 'Sed quia non numquam eius modi tempora',
        emblem: 'triangle.svg',
        state: 'Pending',
        factionId: ''
      }
    ];
    fs.writeFileSync(DATA_FILE, JSON.stringify(dummyJobs, null, 2));
  }
}

// Read jobs from file
function readJobs() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Write jobs to file
function writeJobs(jobs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jobs, null, 2));
}

// Migrate old jobs to add state and factionId fields (one-time operation)
function migrateJobsIfNeeded() {
  const jobs = readJobs();
  let needsMigration = false;
  
  const migratedJobs = jobs.map(job => {
    const stateMissing = job.state === undefined || job.state === null;
    const factionIdMissing = !job.hasOwnProperty('factionId');

    if (stateMissing || factionIdMissing) {
      needsMigration = true;
      return {
        ...job,
        // Only default when state is actually missing (undefined or null)
        state: job.state ?? helpers.DEFAULT_JOB_STATE,
        // Only default factionId when the property is missing
        factionId: factionIdMissing ? '' : job.factionId
      };
    }
    return job;
  });
  
  if (needsMigration) {
    writeJobs(migratedJobs);
    console.log('Jobs migrated to include state and factionId fields');
  }
}

// Helper function to create faction lookup map
function createFactionMap(factions) {
  const factionMap = {};
  factions.forEach(f => {
    factionMap[f.id] = f;
  });
  return factionMap;
}

// Helper function to enrich jobs with faction data
function enrichJobsWithFactions(jobs, factions) {
  const factionMap = createFactionMap(factions);
  return jobs.map(job => ({
    ...job,
    faction: factionMap[job.factionId] || null
  }));
}

// Helper function to enrich all factions with job counts
function enrichAllFactions(factions, jobs) {
  return factions.map(faction => helpers.enrichFactionWithJobCounts(faction, jobs));
}

// Helper function to validate job data
function validateJobData(jobData, factions, uploadDir) {
  // Validate emblem
  const emblemValidation = helpers.validateEmblem(jobData.emblem, uploadDir);
  if (!emblemValidation.valid) {
    return { valid: false, message: emblemValidation.message };
  }
  
  // Validate job state
  const stateValidation = helpers.validateJobState(jobData.state);
  if (!stateValidation.valid) {
    return { valid: false, message: stateValidation.message };
  }
  
  // Validate factionId if provided (optional)
  const factionId = jobData.factionId || '';
  if (factionId) {
    const factionValidation = helpers.validateFactionId(factionId, factions);
    if (!factionValidation.valid) {
      return { valid: false, message: factionValidation.message };
    }
  }
  
  return { 
    valid: true, 
    emblem: jobData.emblem,
    state: stateValidation.value,
    factionId: factionId
  };
}

// Helper function to validate faction data
function validateFactionData(factionData, uploadDir) {
  // Validate title
  const titleValidation = helpers.validateRequiredString(factionData.title, 'Faction title');
  if (!titleValidation.valid) {
    return { valid: false, message: titleValidation.message };
  }
  
  // Validate brief
  const briefValidation = helpers.validateRequiredString(factionData.brief, 'Faction brief');
  if (!briefValidation.valid) {
    return { valid: false, message: briefValidation.message };
  }
  
  // Validate emblem
  const emblemValidation = helpers.validateEmblem(factionData.emblem, uploadDir);
  if (!emblemValidation.valid) {
    return { valid: false, message: emblemValidation.message };
  }
  
  // Validate standing
  const standingValidation = helpers.validateInteger(factionData.standing, 'Standing', 0, 4);
  if (!standingValidation.valid) {
    return { valid: false, message: standingValidation.message };
  }
  
  return {
    valid: true,
    title: titleValidation.value,
    brief: briefValidation.value,
    emblem: factionData.emblem,
    standing: standingValidation.value,
    jobsCompletedOffset: parseInt(factionData.jobsCompletedOffset) || 0,
    jobsFailedOffset: parseInt(factionData.jobsFailedOffset) || 0
  };
}

// Helper function to validate pilot data
function validatePilotData(pilotData) {
  // Validate name
  const nameValidation = helpers.validateRequiredString(pilotData.name, 'Pilot name');
  if (!nameValidation.valid) {
    return { valid: false, message: nameValidation.message };
  }
  
  // Validate callsign
  const callsignValidation = helpers.validateRequiredString(pilotData.callsign, 'Callsign');
  if (!callsignValidation.valid) {
    return { valid: false, message: callsignValidation.message };
  }
  
  // Validate LL (License Level)
  const llValidation = helpers.validateInteger(pilotData.ll, 'License Level', 0, 12);
  if (!llValidation.valid) {
    return { valid: false, message: llValidation.message };
  }
  
  // Validate personalOperationProgress (0-3)
  const progressValidation = helpers.validateInteger(
    pilotData.personalOperationProgress ?? 0,
    'Personal Operation Progress',
    0,
    3
  );
  if (!progressValidation.valid) {
    return { valid: false, message: progressValidation.message };
  }
  
  // Validate relatedJobs array if provided
  let relatedJobs = [];
  if (pilotData.relatedJobs) {
    try {
      relatedJobs = Array.isArray(pilotData.relatedJobs) ? pilotData.relatedJobs : JSON.parse(pilotData.relatedJobs);
      if (!Array.isArray(relatedJobs)) {
        return { valid: false, message: 'Related jobs must be an array' };
      }
    } catch (e) {
      return { valid: false, message: 'Invalid related jobs format' };
    }
  }
  
  return {
    valid: true,
    name: nameValidation.value,
    callsign: callsignValidation.value,
    ll: llValidation.value,
    reserves: (pilotData.reserves || '').trim(),
    active: pilotData.active === 'true' || pilotData.active === true,
    relatedJobs: relatedJobs,
    personalOperationProgress: progressValidation.value
  };
}

// Default settings object
const DEFAULT_SETTINGS = {
  portalHeading: 'HERM00R MERCENARY PORTAL',
  unt: '',
  currentGalacticPos: '',
  colorScheme: 'grey',
  userGroup: 'FREELANCE_OPERATORS',
  operationProgress: 0,
  openTable: false
};

// Read settings from file
function readSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
    // Merge with defaults to ensure all required fields exist
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

// Write settings to file
function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Initialize Manna data
function initializeManna() {
  if (!fs.existsSync(MANNA_FILE)) {
    const defaultManna = {
      balance: 1300,
      transactions: [
        {
          id: helpers.generateId(),
          date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          amount: 500,
          description: 'Lorem ipsum dolor sit',
          balance: 800
        },
        {
          id: helpers.generateId(),
          date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          amount: -200,
          description: 'Consectetur adipiscing',
          balance: 600
        },
        {
          id: helpers.generateId(),
          date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          amount: 700,
          description: 'Sed do eiusmod tempor',
          balance: 1300
        }
      ]
    };
    fs.writeFileSync(MANNA_FILE, JSON.stringify(defaultManna, null, 2));
  }
}

// Read Manna data
function readManna() {
  try {
    const data = fs.readFileSync(MANNA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { balance: 0, transactions: [] };
  }
}

// Write Manna data
function writeManna(manna) {
  fs.writeFileSync(MANNA_FILE, JSON.stringify(manna, null, 2));
}

// Initialize Base modules
function initializeBase() {
  if (!fs.existsSync(BASE_FILE)) {
    const defaultBase = {
      modules: [
        // 3 Core modules - at least one partially filled
        { type: 'Core', title: 'Lorem Ipsum', description: 'Dolor sit amet consectetur adipiscing elit', disabled: false },
        { type: 'Core', title: '', description: '', disabled: false },
        { type: 'Core', title: '', description: '', disabled: false },
        // 6 Major modules - at least one partially filled
        { type: 'Major', title: 'Sed Do Eiusmod', description: 'Tempor incididunt ut labore et dolore magna', disabled: false },
        { type: 'Major', title: '', description: '', disabled: false },
        { type: 'Major', title: '', description: '', disabled: false },
        { type: 'Major', title: '', description: '', disabled: false },
        { type: 'Major', title: '', description: '', disabled: false },
        { type: 'Major', title: '', description: '', disabled: false },
        // 6 Minor modules (last 2 disabled by default) - at least one partially filled
        { type: 'Minor', title: 'Ut Enim Minim', description: 'Quis nostrud exercitation ullamco laboris', disabled: false },
        { type: 'Minor', title: '', description: '', disabled: false },
        { type: 'Minor', title: '', description: '', disabled: false },
        { type: 'Minor', title: '', description: '', disabled: false },
        { type: 'Minor', title: '', description: '', disabled: true },
        { type: 'Minor', title: '', description: '', disabled: true }
      ]
    };
    fs.writeFileSync(BASE_FILE, JSON.stringify(defaultBase, null, 2));
  }
}

// Read Base data
function readBase() {
  try {
    const data = fs.readFileSync(BASE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    initializeBase();
    return readBase();
  }
}

// Write Base data
function writeBase(base) {
  fs.writeFileSync(BASE_FILE, JSON.stringify(base, null, 2));
}

// Initialize Factions
function initializeFactions() {
  if (!fs.existsSync(FACTIONS_FILE)) {
    const defaultFactions = [
      {
        id: '1',
        title: 'Conglomerate Finibus',
        emblem: 'construction.svg',
        brief: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        standing: 2,
        jobsCompletedOffset: 3,
        jobsFailedOffset: 1
      },
      {
        id: '2',
        title: 'Shimano Industries',
        emblem: 'cosmetics.svg',
        brief: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
        standing: 3,
        jobsCompletedOffset: 5,
        jobsFailedOffset: 0
      },
      {
        id: '3',
        title: 'Collective Malorum',
        emblem: 'engineering.svg',
        brief: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
        standing: 1,
        jobsCompletedOffset: 1,
        jobsFailedOffset: 2
      }
    ];
    fs.writeFileSync(FACTIONS_FILE, JSON.stringify(defaultFactions, null, 2));
  }
}

// Read Factions
function readFactions() {
  try {
    const data = fs.readFileSync(FACTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Write Factions
function writeFactions(factions) {
  fs.writeFileSync(FACTIONS_FILE, JSON.stringify(factions, null, 2));
}

// Migrate old factions to add offset fields (one-time operation)
function migrateFactionsIfNeeded() {
  const factions = readFactions();
  let needsMigration = false;
  
  const migratedFactions = factions.map(faction => {
    const hasJobsCompletedOffset = Object.prototype.hasOwnProperty.call(faction, 'jobsCompletedOffset');
    const hasJobsFailedOffset = Object.prototype.hasOwnProperty.call(faction, 'jobsFailedOffset');
    const hasLegacyJobsCompleted = Object.prototype.hasOwnProperty.call(faction, 'jobsCompleted');
    const hasLegacyJobsFailed = Object.prototype.hasOwnProperty.call(faction, 'jobsFailed');
    const offsetFieldsMissing = !hasJobsCompletedOffset || !hasJobsFailedOffset;
    
    // Always strip legacy fields from the returned object
    const { jobsCompleted, jobsFailed, ...rest } = faction;
    
    if (offsetFieldsMissing || hasLegacyJobsCompleted || hasLegacyJobsFailed) {
      needsMigration = true;
      // Remove legacy fields and initialize missing offset fields from their values (or 0 if missing)
      return {
        ...rest,
        ...(hasJobsCompletedOffset ? {} : { jobsCompletedOffset: jobsCompleted || 0 }),
        ...(hasJobsFailedOffset ? {} : { jobsFailedOffset: jobsFailed || 0 })
      };
    }
    
    // No migration needed: offsets already exist and no legacy fields were present
    return rest;
  });
  
  if (needsMigration) {
    writeFactions(migratedFactions);
    console.log('Factions migrated to use offset fields for job counts');
  }
}

// Initialize Pilots
function initializePilots() {
  if (!fs.existsSync(PILOTS_FILE)) {
    const defaultPilots = [
      {
        id: helpers.generateId(),
        name: 'Lorem Ipsum',
        callsign: 'Dolor',
        ll: 3,
        reserves: 'Lorem ipsum dolor sit amet\nConsectetur adipiscing elit',
        active: true,
        relatedJobs: [],
        personalOperationProgress: 2
      },
      {
        id: helpers.generateId(),
        name: 'Sit Amet',
        callsign: 'Consectetur',
        ll: 5,
        reserves: 'Sed do eiusmod tempor\nIncididunt ut labore',
        active: true,
        relatedJobs: [],
        personalOperationProgress: 0
      },
      {
        id: helpers.generateId(),
        name: 'Magna Aliqua',
        callsign: 'Tempor',
        ll: 2,
        reserves: 'Ut enim ad minim veniam\nQuis nostrud exercitation',
        active: false,
        relatedJobs: [],
        personalOperationProgress: 0
      }
    ];
    fs.writeFileSync(PILOTS_FILE, JSON.stringify(defaultPilots, null, 2));
  }
}

// Read Pilots
function readPilots() {
  try {
    const data = fs.readFileSync(PILOTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Write Pilots
function writePilots(pilots) {
  fs.writeFileSync(PILOTS_FILE, JSON.stringify(pilots, null, 2));
}

// Migrate old pilots to add personalOperationProgress field (one-time operation)
function migratePilotsIfNeeded() {
  const pilots = readPilots();
  let needsMigration = false;
  
  const migratedPilots = pilots.map(pilot => {
    const progressMissing = !pilot.hasOwnProperty('personalOperationProgress');
    
    if (progressMissing) {
      needsMigration = true;
      return {
        ...pilot,
        personalOperationProgress: 0
      };
    }
    return pilot;
  });
  
  if (needsMigration) {
    writePilots(migratedPilots);
    console.log('Pilots migrated to include personalOperationProgress field');
  }
}

// File storage (Upload Emblem)
const multer = require('multer');
const potrace = require('potrace');

const uploadDir = path.join(__dirname, 'logo_art');
fs.mkdirSync(uploadDir, { recursive: true });

const tmpUploadDir = path.join(__dirname, 'data', 'uploads_tmp');
fs.mkdirSync(tmpUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpUploadDir),
  filename: (req, file, cb) => {
    const normalized = String(file.originalname || '').replace(/\\/g, '/');
    const ext = path.posix.extname(normalized).toLowerCase();
    cb(null, `${helpers.generateId()}${ext || ''}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!FILE_UPLOAD.ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, and BMP images are allowed'));
    }
    cb(null, true);
  },
  limits: {
    files: 1,
    fileSize: FILE_UPLOAD.MAX_SIZE
  }
});

// Save uploaded Emblem files to logo_art + .svg conversion (overwrite-by-name)
app.post('/upload', (req, res) => {
  upload.single('myFile')(req, res, async (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const base = helpers.sanitizeEmblemBaseName(req.file.originalname);
    if (!base) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch {
        // ignore
      }
      return res.status(400).json({ success: false, message: 'Invalid file name' });
    }

    const svgFilename = `${base}.svg`;
    const outputPath = path.join(uploadDir, svgFilename);

    try {
      const svg = await new Promise((resolve, reject) => {
        potrace.trace(req.file.path, { threshold: 128 }, (traceErr, result) => {
          if (traceErr) return reject(traceErr);
          resolve(result);
        });
      });

      await fs.promises.writeFile(outputPath, svg, 'utf8');
      return res.json({
        success: true,
        emblem: svgFilename,
        url: `/emblems/${encodeURIComponent(svgFilename)}`
      });
    } catch (convertErr) {
      console.error(convertErr);
      return res.status(500).json({ success: false, message: 'SVG conversion failed' });
    } finally {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupErr) {
        if (cleanupErr && cleanupErr.code !== 'ENOENT') {
          console.error('Temp cleanup failed:', cleanupErr);
        }
      }
    }
  });
});

// Initialize data on startup
initializeData();
initializeSettings();
initializeManna();
initializeBase();
initializeFactions();
initializePilots();

// Migrate existing jobs to add new fields
migrateJobsIfNeeded();

// Migrate existing factions to add offset fields
migrateFactionsIfNeeded();

// Migrate existing pilots to add personalOperationProgress field
migratePilotsIfNeeded();

// SSE broadcast function
function broadcastSSE(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(message);
    } catch (err) {
      // Client disconnected, remove from client set to prevent repeated errors
      sseClients.delete(client);
      console.error('Error writing to SSE client:', err);
    }
  });
}

// SSE endpoint
app.get('/api/sse', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Send initial connection message
  res.write('event: connected\ndata: {"message":"SSE connection established"}\n\n');
  
  // Add client to set
  sseClients.add(res);
  
  // Send keep-alive every 30 seconds
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (err) {
      clearInterval(keepAliveInterval);
    }
  }, 30000);
  
  // Remove client on disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(res);
  });
});

// Routes
app.get('/', (req, res) => {
  const settings = readSettings();
  res.render('landing', { error: req.query.error, colorScheme: settings.colorScheme, settings });
});

app.post('/authenticate', (req, res) => {
  const password = req.body.password;
  if (password === PASSWORDS.CLIENT) {
    res.redirect('/client/overview');
  } else if (password === PASSWORDS.ADMIN) {
    res.redirect('/admin');
  } else {
    res.redirect('/?error=invalid');
  }
});

// Client routes
app.get('/client', (req, res) => {
  res.redirect('/client/overview');
});

app.get('/client/overview', (req, res) => {
  const settings = readSettings();
  const manna = readManna();
  // Get last 5 transactions
  const recentTransactions = manna.transactions.slice(-5).reverse();
  res.render('client-overview', { settings, colorScheme: settings.colorScheme, manna, recentTransactions });
});

app.get('/client/finances', (req, res) => {
  const settings = readSettings();
  const manna = readManna();
  res.render('client-finances', { settings, colorScheme: settings.colorScheme, manna });
});

app.get('/client/jobs', (req, res) => {
  const allJobs = readJobs();
  // Filter to show only Active jobs for clients
  const jobs = allJobs.filter(job => job.state === 'Active');
  const settings = readSettings();
  const factions = readFactions();
  
  // Enrich jobs with faction data
  const enrichedJobs = enrichJobsWithFactions(jobs, factions);
  
  res.render('client-jobs', { jobs: enrichedJobs, settings, colorScheme: settings.colorScheme });
});

app.get('/client/base', (req, res) => {
  const settings = readSettings();
  const base = readBase();
  res.render('client-base', { settings, colorScheme: settings.colorScheme, base });
});

app.get('/client/factions', (req, res) => {
  const settings = readSettings();
  const factions = readFactions();
  const jobs = readJobs();
  
  // Enrich factions with calculated job counts
  const enrichedFactions = enrichAllFactions(factions, jobs);
  
  res.render('client-factions', { settings, colorScheme: settings.colorScheme, factions: enrichedFactions });
});

app.get('/client/pilots', (req, res) => {
  const settings = readSettings();
  const pilots = readPilots();
  res.render('client-pilots', { settings, colorScheme: settings.colorScheme, pilots });
});

app.get('/admin', (req, res) => {
  const jobs = readJobs();
  const settings = readSettings();
  const manna = readManna();
  const base = readBase();
  const factions = readFactions();
  const pilots = readPilots();
  const emblemFiles = fs.readdirSync(path.join(__dirname, 'logo_art'))
    .filter(file => file.endsWith('.svg'))
    .sort();
  
  // Enrich factions with calculated job counts
  const enrichedFactions = enrichAllFactions(factions, jobs);
  
  // Create faction lookup map for efficient template rendering
  const factionMap = createFactionMap(enrichedFactions);
  
  // Enrich jobs with faction data and state class
  const enrichedJobs = jobs.map(job => ({
    ...job,
    stateClass: job.state ? job.state.toLowerCase() : helpers.DEFAULT_JOB_STATE.toLowerCase(),
    faction: factionMap[job.factionId] || null
  }));
  
  res.render('admin', { 
    jobs: enrichedJobs, 
    settings, 
    manna, 
    base, 
    factions: enrichedFactions, 
    pilots,
    emblems: emblemFiles, 
    formatEmblemTitle: helpers.formatEmblemTitle,
    jobStates: helpers.JOB_STATES,
    defaultJobState: helpers.DEFAULT_JOB_STATE
  });
});

// API endpoints for admin operations
app.get('/api/jobs', (req, res) => {
  const jobs = readJobs();
  const factions = readFactions();
  
  // Enrich jobs with faction data
  const enrichedJobs = enrichJobsWithFactions(jobs, factions);
  
  res.json(enrichedJobs);
});

app.post('/api/jobs', (req, res) => {
  const jobs = readJobs();
  const factions = readFactions();
  
  // Validate job data
  const validation = validateJobData(req.body, factions, uploadDir);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  const newJob = {
    id: helpers.generateId(),
    name: req.body.name,
    rank: parseInt(req.body.rank),
    jobType: req.body.jobType,
    description: req.body.description,
    clientBrief: req.body.clientBrief,
    currencyPay: req.body.currencyPay,
    additionalPay: req.body.additionalPay,
    emblem: validation.emblem,
    state: validation.state,
    factionId: validation.factionId
  };
  jobs.push(newJob);
  writeJobs(jobs);
  
  // Broadcast SSE update
  broadcastSSE('jobs', { action: 'create', job: newJob, jobs });
  
  res.json({ success: true, job: newJob });
});

app.put('/api/jobs/:id', (req, res) => {
  const jobs = readJobs();
  const factions = readFactions();
  
  const index = jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Job not found' });
  }
  
  // Validate job data
  const validation = validateJobData(req.body, factions, uploadDir);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  jobs[index] = {
    id: req.params.id,
    name: req.body.name,
    rank: parseInt(req.body.rank),
    jobType: req.body.jobType,
    description: req.body.description,
    clientBrief: req.body.clientBrief,
    currencyPay: req.body.currencyPay,
    additionalPay: req.body.additionalPay,
    emblem: validation.emblem,
    state: validation.state,
    factionId: validation.factionId
  };
  writeJobs(jobs);
  
  // Broadcast SSE update
  broadcastSSE('jobs', { action: 'update', job: jobs[index], jobs });
  
  res.json({ success: true, job: jobs[index] });
});

app.delete('/api/jobs/:id', (req, res) => {
  let jobs = readJobs();
  jobs = jobs.filter(j => j.id !== req.params.id);
  writeJobs(jobs);
  
  // Broadcast SSE update
  broadcastSSE('jobs', { action: 'delete', jobId: req.params.id, jobs });
  
  res.json({ success: true });
});

// API endpoint to update job state only
app.put('/api/jobs/:id/state', (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex(j => j.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Job not found' });
  }
  
  // Validate job state
  const stateValidation = helpers.validateJobState(req.body.state);
  if (!stateValidation.valid) {
    return res.status(400).json({ success: false, message: stateValidation.message });
  }
  
  // Update only the state field
  jobs[index].state = stateValidation.value;
  writeJobs(jobs);
  
  // Broadcast SSE update
  broadcastSSE('jobs', { action: 'update', job: jobs[index], jobs });
  
  res.json({ success: true, job: jobs[index] });
});

// API endpoints for settings
app.get('/api/settings', (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  // Validate portal heading
  const headingValidation = helpers.validateRequiredString(req.body.portalHeading, 'Portal Heading', 100);
  if (!headingValidation.valid) {
    return res.status(400).json({ success: false, message: headingValidation.message });
  }
  
  // Validate color scheme
  const colorScheme = req.body.colorScheme || 'grey';
  if (!helpers.isValidColorScheme(colorScheme)) {
    return res.status(400).json({ 
      success: false, 
      message: `Invalid color scheme. Must be one of: ${helpers.VALID_COLOR_SCHEMES.join(', ')}` 
    });
  }
  
  // Validate user group
  const userGroupValidation = helpers.validateRequiredString(req.body.userGroup, 'User Group', 100);
  if (!userGroupValidation.valid) {
    return res.status(400).json({ success: false, message: userGroupValidation.message });
  }
  
  // Validate UNT date format
  const unt = req.body.unt ?? '';
  const dateValidation = helpers.validateDate(unt);
  if (!dateValidation.valid) {
    return res.status(400).json({ success: false, message: dateValidation.message });
  }
  
  // Validate operation progress
  const operationProgress = parseInt(req.body.operationProgress ?? 0);
  if (isNaN(operationProgress) || operationProgress < 0 || operationProgress > 3) {
    return res.status(400).json({ 
      success: false, 
      message: 'Operation Progress must be between 0 and 3' 
    });
  }
  
  // Parse openTable boolean
  const openTable = req.body.openTable === 'true' || req.body.openTable === true;
  
  const settings = {
    portalHeading: headingValidation.value,
    unt: unt.trim(),
    currentGalacticPos: (req.body.currentGalacticPos ?? '').trim(),
    colorScheme: colorScheme,
    userGroup: userGroupValidation.value,
    operationProgress: operationProgress,
    openTable: openTable
  };
  
  writeSettings(settings);
  
  // Broadcast SSE update
  broadcastSSE('settings', { action: 'update', settings });
  
  res.json({ success: true, settings });
});

// API endpoint to delete emblem
app.delete('/api/emblems/:filename', async (req, res) => {
  const filename = req.params.filename;
  
  // Validate filename
  if (!helpers.isSafeEmblemFilename(filename)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid emblem filename' 
    });
  }
  
  const emblemPath = path.join(uploadDir, filename);
  
  // Check if emblem file exists
  if (!fs.existsSync(emblemPath)) {
    return res.status(404).json({ 
      success: false, 
      message: 'Emblem not found' 
    });
  }
  
  // Check if emblem is in use by any job or faction
  const jobs = readJobs();
  const factions = readFactions();
  const inUseByJob = jobs.some(job => job.emblem === filename);
  const inUseByFaction = factions.some(faction => faction.emblem === filename);
  if (inUseByJob || inUseByFaction) {
    return res.status(409).json({ 
      success: false, 
      message: 'Cannot delete emblem: it is currently in use by one or more jobs or factions' 
    });
  }
  
  // Delete the emblem file
  try {
    await fs.promises.unlink(emblemPath);
    res.json({ success: true, message: 'Emblem deleted successfully' });
  } catch (error) {
    console.error('Error deleting emblem:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete emblem file' 
    });
  }
});

// Manna API endpoints
app.get('/api/manna', (req, res) => {
  const manna = readManna();
  res.json(manna);
});

app.put('/api/manna', (req, res) => {
  // Validate balance parameter
  if (req.body.balance === undefined || req.body.balance === null) {
    return res.status(400).json({ 
      success: false, 
      message: 'Balance is required' 
    });
  }
  
  const balance = parseInt(req.body.balance);
  if (isNaN(balance)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Balance must be a valid number' 
    });
  }
  
  const description = req.body.description || '';
  const amount = parseInt(req.body.amount) || 0;
  
  const manna = readManna();
  manna.balance = balance;
  
  // Add transaction if amount is provided
  if (amount !== 0 && description) {
    manna.transactions.push({
      id: helpers.generateId(),
      date: new Date().toISOString(),
      amount: amount,
      description: description,
      balance: balance
    });
  }
  
  writeManna(manna);
  
  // Broadcast SSE update
  broadcastSSE('manna', { action: 'update', manna });
  
  res.json({ success: true, manna });
});

app.post('/api/manna/transaction', (req, res) => {
  const amount = parseInt(req.body.amount) || 0;
  const description = req.body.description || '';
  
  if (!description.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Transaction description is required' 
    });
  }
  
  const manna = readManna();
  manna.balance += amount;
  
  manna.transactions.push({
    id: helpers.generateId(),
    date: new Date().toISOString(),
    amount: amount,
    description: description.trim(),
    balance: manna.balance
  });
  
  writeManna(manna);
  
  // Broadcast SSE update
  broadcastSSE('manna', { action: 'transaction', manna });
  
  res.json({ success: true, manna });
});

app.put('/api/manna/transaction/:id', (req, res) => {
  const manna = readManna();
  const transactionIndex = manna.transactions.findIndex(t => t.id === req.params.id);
  
  if (transactionIndex === -1) {
    return res.status(404).json({ 
      success: false, 
      message: 'Transaction not found' 
    });
  }
  
  // Validate inputs
  const amount = parseInt(req.body.amount);
  const description = req.body.description || '';
  const date = req.body.date;
  
  if (isNaN(amount)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Amount must be a valid number' 
    });
  }
  
  if (!description.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Transaction description is required' 
    });
  }
  
  if (!date) {
    return res.status(400).json({ 
      success: false, 
      message: 'Transaction date is required' 
    });
  }
  
  // Update transaction preserving balance
  manna.transactions[transactionIndex] = {
    id: req.params.id,
    date: date,
    amount: amount,
    description: description.trim(),
    balance: manna.transactions[transactionIndex].balance // Keep original balance
  };
  
  writeManna(manna);
  
  // Broadcast SSE update
  broadcastSSE('manna', { action: 'update', manna });
  
  res.json({ success: true, transaction: manna.transactions[transactionIndex] });
});

app.delete('/api/manna/transaction/:id', (req, res) => {
  const manna = readManna();
  const transactionIndex = manna.transactions.findIndex(t => t.id === req.params.id);
  
  if (transactionIndex === -1) {
    return res.status(404).json({ 
      success: false, 
      message: 'Transaction not found' 
    });
  }
  
  // Remove the transaction without affecting the balance
  manna.transactions.splice(transactionIndex, 1);
  
  writeManna(manna);
  
  // Broadcast SSE update
  broadcastSSE('manna', { action: 'delete', manna });
  
  res.json({ success: true });
});

// Base API endpoints
app.get('/api/base', (req, res) => {
  const base = readBase();
  res.json(base);
});

app.put('/api/base', (req, res) => {
  const modules = req.body.modules;
  
  if (!Array.isArray(modules) || modules.length !== BASE_MODULES.TOTAL_COUNT) {
    return res.status(400).json({ 
      success: false, 
      message: `Base must have exactly ${BASE_MODULES.TOTAL_COUNT} modules` 
    });
  }
  
  writeBase({ modules });
  
  // Broadcast SSE update
  broadcastSSE('base', { action: 'update', base: { modules } });
  
  res.json({ success: true, base: { modules } });
});

// Factions API endpoints
app.get('/api/factions', (req, res) => {
  const factions = readFactions();
  const jobs = readJobs();
  
  // Enrich factions with calculated job counts
  const enrichedFactions = enrichAllFactions(factions, jobs);
  
  res.json(enrichedFactions);
});

app.post('/api/factions', (req, res) => {
  // Validate faction data
  const validation = validateFactionData(req.body, uploadDir);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  const factions = readFactions();
  const jobs = readJobs();
  const newFaction = {
    id: helpers.generateId(),
    title: validation.title,
    emblem: validation.emblem,
    brief: validation.brief,
    standing: validation.standing,
    jobsCompletedOffset: validation.jobsCompletedOffset,
    jobsFailedOffset: validation.jobsFailedOffset
  };
  factions.push(newFaction);
  writeFactions(factions);
  
  // Enrich the new faction with calculated counts for the response
  const enrichedFaction = helpers.enrichFactionWithJobCounts(newFaction, jobs);
  
  // Broadcast SSE update with all enriched factions
  const enrichedFactions = enrichAllFactions(factions, jobs);
  broadcastSSE('factions', { action: 'create', faction: enrichedFaction, factions: enrichedFactions });
  
  res.json({ success: true, faction: enrichedFaction });
});

app.put('/api/factions/:id', (req, res) => {
  const factions = readFactions();
  const index = factions.findIndex(f => f.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Faction not found' });
  }
  
  // Validate faction data
  const validation = validateFactionData(req.body, uploadDir);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  const jobs = readJobs();
  factions[index] = {
    id: req.params.id,
    title: validation.title,
    emblem: validation.emblem,
    brief: validation.brief,
    standing: validation.standing,
    jobsCompletedOffset: validation.jobsCompletedOffset,
    jobsFailedOffset: validation.jobsFailedOffset
  };
  writeFactions(factions);
  
  // Enrich the updated faction with calculated counts for the response
  const enrichedFaction = helpers.enrichFactionWithJobCounts(factions[index], jobs);
  
  // Broadcast SSE update with all enriched factions
  const enrichedFactions = enrichAllFactions(factions, jobs);
  broadcastSSE('factions', { action: 'update', faction: enrichedFaction, factions: enrichedFactions });
  
  res.json({ success: true, faction: enrichedFaction });
});

app.delete('/api/factions/:id', (req, res) => {
  let factions = readFactions();
  const jobs = readJobs();
  factions = factions.filter(f => f.id !== req.params.id);
  writeFactions(factions);
  
  // Broadcast SSE update with enriched factions
  const enrichedFactions = enrichAllFactions(factions, jobs);
  broadcastSSE('factions', { action: 'delete', factionId: req.params.id, factions: enrichedFactions });
  
  res.json({ success: true });
});

// Pilots API endpoints
app.get('/api/pilots', (req, res) => {
  const pilots = readPilots();
  res.json(pilots);
});

app.post('/api/pilots', (req, res) => {
  // Validate pilot data
  const validation = validatePilotData(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  const pilots = readPilots();
  const newPilot = {
    id: helpers.generateId(),
    name: validation.name,
    callsign: validation.callsign,
    ll: validation.ll,
    reserves: validation.reserves,
    active: validation.active,
    relatedJobs: [],
    personalOperationProgress: validation.personalOperationProgress
  };
  pilots.push(newPilot);
  writePilots(pilots);
  
  // Broadcast SSE update
  broadcastSSE('pilots', { action: 'create', pilot: newPilot, pilots });
  
  res.json({ success: true, pilot: newPilot });
});

app.put('/api/pilots/:id', (req, res) => {
  const pilots = readPilots();
  const index = pilots.findIndex(p => p.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Pilot not found' });
  }
  
  // Validate pilot data
  const validation = validatePilotData(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }
  
  pilots[index] = {
    id: req.params.id,
    name: validation.name,
    callsign: validation.callsign,
    ll: validation.ll,
    reserves: validation.reserves,
    active: validation.active,
    relatedJobs: validation.relatedJobs,
    personalOperationProgress: validation.personalOperationProgress
  };
  writePilots(pilots);
  
  // Broadcast SSE update
  broadcastSSE('pilots', { action: 'update', pilot: pilots[index], pilots });
  
  res.json({ success: true, pilot: pilots[index] });
});

app.delete('/api/pilots/:id', (req, res) => {
  let pilots = readPilots();
  pilots = pilots.filter(p => p.id !== req.params.id);
  writePilots(pilots);
  
  // Broadcast SSE update
  broadcastSSE('pilots', { action: 'delete', pilotId: req.params.id, pilots });
  
  res.json({ success: true });
});

// Update pilot reserves only (CLIENT-side endpoint)
app.put('/api/pilots/:id/reserves', (req, res) => {
  const pilots = readPilots();
  const index = pilots.findIndex(p => p.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Pilot not found' });
  }
  
  // Update only reserves field
  pilots[index].reserves = (req.body.reserves || '').trim();
  writePilots(pilots);
  
  // Broadcast SSE update
  broadcastSSE('pilots', { action: 'update', pilot: pilots[index], pilots });
  
  res.json({ success: true, pilot: pilots[index] });
});

// Progress all jobs endpoint
app.post('/api/jobs/progress-all', (req, res) => {
  const jobs = readJobs();
  const pilots = readPilots();
  
  // Update job states and track newly active jobs in a single pass
  const newlyActiveJobIds = [];
  let jobsModified = 0;
  
  const updatedJobs = jobs.map(job => {
    if (job.state === 'Active') {
      jobsModified++;
      return { ...job, state: 'Ignored' };
    } else if (job.state === 'Pending') {
      jobsModified++;
      newlyActiveJobIds.push(job.id);
      return { ...job, state: 'Active' };
    }
    return job;
  });
  
  // Add newly active jobs to all active pilots' related jobs
  const updatedPilots = pilots.map(pilot => {
    if (pilot.active && newlyActiveJobIds.length > 0) {
      const existingJobIds = new Set(pilot.relatedJobs || []);
      newlyActiveJobIds.forEach(jobId => existingJobIds.add(jobId));
      return { ...pilot, relatedJobs: Array.from(existingJobIds) };
    }
    return pilot;
  });
  
  // Write updated data
  writeJobs(updatedJobs);
  writePilots(updatedPilots);
  
  // Broadcast SSE updates
  broadcastSSE('jobs', { action: 'progress-all', jobs: updatedJobs });
  broadcastSSE('pilots', { action: 'update-multiple', pilots: updatedPilots });
  
  res.json({ 
    success: true, 
    jobsProgressed: jobsModified,
    pilotsUpdated: updatedPilots.filter(p => p.active).length,
    newlyActiveJobs: newlyActiveJobIds.length
  });
});

// Progress operation for active pilots endpoint
app.post('/api/pilots/progress-operation', (req, res) => {
  const pilots = readPilots();
  
  // Track pilots that were reset to 0
  const resetPilots = [];
  let pilotsProgressed = 0;
  
  // Update personalOperationProgress for all active pilots
  const updatedPilots = pilots.map(pilot => {
    if (pilot.active) {
      pilotsProgressed++;
      const currentProgress = pilot.personalOperationProgress ?? 0;
      const newProgress = currentProgress >= 3 ? 0 : currentProgress + 1;
      
      if (newProgress === 0 && currentProgress === 3) {
        resetPilots.push({
          name: pilot.name,
          callsign: pilot.callsign
        });
      }
      
      return { ...pilot, personalOperationProgress: newProgress };
    }
    return pilot;
  });
  
  // Write updated data
  writePilots(updatedPilots);
  
  // Broadcast SSE update
  broadcastSSE('pilots', { action: 'progress-operation', pilots: updatedPilots });
  
  res.json({
    success: true,
    pilotsProgressed,
    resetPilots
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
