const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser');
const multer = require('multer');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(cookieParser());
app.use(session({
    secret: 'raffle-secret-key',
    resave: false,
    saveUninitialized: true
}));

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Set up express-ejs-layouts
app.use(expressLayouts);
app.set('layout', 'layout');
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Helper function to read raffles
const readRaffles = () => {
    const rafflesPath = path.join(dataDir, 'raffles.json');
    if (fs.existsSync(rafflesPath)) {
        return JSON.parse(fs.readFileSync(rafflesPath, 'utf8'));
    }
    return [];
};

// Helper function to write raffles
const writeRaffles = (raffles) => {
    const rafflesPath = path.join(dataDir, 'raffles.json');
    fs.writeFileSync(rafflesPath, JSON.stringify(raffles, null, 2));
};

// Helper function to generate a unique ticket number
const generateTicketNumber = (raffleId, index) => {
    // Create a formatted raffle ID + sequential number
    return `${raffleId.substring(0, 6)}-${String(index+1).padStart(5, '0')}`;
};

// Username management middleware
app.use((req, res, next) => {
    res.locals.username = req.cookies.username;
    res.locals.isAdmin = req.cookies.username === process.env.ADMIN_USERNAME;
    next();
});

// Username management routes
app.post('/set-username', (req, res) => {
    const username = req.body.username.trim();
    if (username) {
        res.cookie('username', username, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year
    }
    res.redirect('back');
});

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images/raffles/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Helper function to calculate impact metrics
const calculateImpactMetrics = (raffles) => {
    let totalRaised = 0;
    let activeRaffles = 0;
    let uniqueSupporters = new Set();

    const now = new Date();

    raffles.forEach(raffle => {
        // All raffles are ticket-based now
        totalRaised += (raffle.soldTickets || 0) * raffle.ticketPrice;
        if (raffle.tickets) {
            raffle.tickets.forEach(ticket => {
                uniqueSupporters.add(ticket.email);
            });
        }

        // Properly handle date comparison
        const endDate = new Date(raffle.endDate);
        if (!isNaN(endDate.getTime()) && endDate > now) {
            activeRaffles++;
        }
    });

    return {
        totalRaised,
        activeRaffles,
        totalSupporters: uniqueSupporters.size
    };
};

// Routes
app.get('/', (req, res) => {
    const raffles = readRaffles();
    const metrics = calculateImpactMetrics(raffles);
    res.render('index', { 
        title: 'West Raffle - Charity Fundraising', 
        raffles,
        metrics 
    });
});

app.get('/raffles', (req, res) => {
    const raffles = readRaffles();
    const metrics = calculateImpactMetrics(raffles);
    res.render('raffles', { 
        title: 'Active Raffles', 
        raffles,
        metrics 
    });
});

app.get('/charity', (req, res) => {
    const raffles = readRaffles();
    const metrics = calculateImpactMetrics(raffles);
    res.render('charity', { 
        title: 'Our Charity Mission',
        metrics
    });
});

app.get('/create-raffle', (req, res) => {
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to create raffles.'
        });
    }
    res.render('create-raffle', { title: 'Create New Raffle' });
});

app.post('/create-raffle', upload.single('image'), (req, res) => {
    const raffles = readRaffles();
    const newRaffle = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
        imageUrl: req.file ? `/images/raffles/${req.file.filename}` : null
    };

    // All raffles are ticket-based now
    newRaffle.raffleType = 'tickets';
    newRaffle.soldTickets = 0;
    newRaffle.tickets = [];
    newRaffle.ticketPrice = parseFloat(req.body.ticketPrice);
    newRaffle.totalTickets = parseInt(req.body.totalTickets);
    newRaffle.prizes = []; // Initialize empty prizes array
    
    raffles.push(newRaffle);
    writeRaffles(raffles);
    
    res.redirect('/raffles');
});

app.get('/raffles/:id', (req, res) => {
    const raffles = readRaffles();
    const raffle = raffles.find(r => r.id === req.params.id);
    
    if (!raffle) {
        return res.status(404).render('error', { 
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }
    
    res.render('raffle-detail', { 
        title: raffle.title,
        raffle 
    });
});

app.post('/raffles/:id/purchase', (req, res) => {
    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    const quantity = parseInt(req.body.quantity);
    
    if (quantity < 1 || quantity > raffle.totalTickets - raffle.soldTickets) {
        return res.status(400).render('error', {
            title: 'Invalid Purchase',
            message: 'Invalid number of tickets requested.'
        });
    }

    // Add tickets to the raffle
    const startIndex = raffle.soldTickets;
    for (let i = 0; i < quantity; i++) {
        const ticketNumber = generateTicketNumber(raffle.id, startIndex + i);
        raffle.tickets.push({
            id: Date.now().toString() + i,
            ticketNumber, // Add unique ticket number
            name: req.body.name,
            email: req.body.email,
            purchaseDate: new Date().toISOString()
        });
    }

    raffle.soldTickets += quantity;
    writeRaffles(raffles);

    // In a real application, you would handle payment processing here
    res.redirect(`/raffles/${raffle.id}?success=true`);
});

// Add a new route for managing prizes
app.get('/raffles/:id/prizes', (req, res) => {
    // Only admins can access this page
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to manage prizes.'
        });
    }

    const raffles = readRaffles();
    const raffle = raffles.find(r => r.id === req.params.id);
    
    if (!raffle) {
        return res.status(404).render('error', { 
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }
    
    res.render('manage-prizes', { 
        title: `Manage Prizes - ${raffle.title}`,
        raffle 
    });
});

// Add a new route for adding prizes
app.post('/raffles/:id/prizes', upload.single('prizeImage'), (req, res) => {
    // Only admins can add prizes
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to add prizes.'
        });
    }

    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    
    // Create a new prize
    const prize = {
        id: Date.now().toString(),
        name: req.body.prizeName,
        description: req.body.prizeDescription,
        value: parseFloat(req.body.prizeValue),
        imageUrl: req.file ? `/images/raffles/${req.file.filename}` : null,
        addedAt: new Date().toISOString(),
        winningTicket: null, // Will be filled when the raffle is drawn
        winner: null // Will be filled when the raffle is drawn
    };
    
    // Add the prize to the raffle
    if (!raffle.prizes) {
        raffle.prizes = [];
    }
    raffle.prizes.push(prize);
    writeRaffles(raffles);
    
    res.redirect(`/raffles/${raffle.id}/prizes`);
});

// Add a new route for drawing the raffle
app.post('/raffles/:id/draw', (req, res) => {
    // Only admins can draw the raffle
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to draw the raffle.'
        });
    }

    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    
    // Check if the raffle has tickets and prizes
    if (!raffle.tickets || raffle.tickets.length === 0) {
        return res.status(400).render('error', {
            title: 'Cannot Draw Raffle',
            message: 'This raffle has no tickets sold.'
        });
    }
    
    if (!raffle.prizes || raffle.prizes.length === 0) {
        return res.status(400).render('error', {
            title: 'Cannot Draw Raffle',
            message: 'This raffle has no prizes to award.'
        });
    }
    
    // Check if the raffle end date has passed
    const now = new Date();
    const endDate = new Date(raffle.endDate);
    if (endDate > now) {
        return res.status(400).render('error', {
            title: 'Cannot Draw Raffle',
            message: 'This raffle has not ended yet.'
        });
    }
    
    // Draw the raffle
    const tickets = [...raffle.tickets];
    
    // For each prize, randomly select a winning ticket
    for (const prize of raffle.prizes) {
        if (tickets.length === 0) break; // Stop if we run out of tickets
        
        // Only draw if this prize hasn't been drawn yet
        if (!prize.winningTicket) {
            // Get a random ticket
            const randomIndex = Math.floor(Math.random() * tickets.length);
            const winningTicket = tickets[randomIndex];
            
            // Remove this ticket from the available tickets pool
            tickets.splice(randomIndex, 1);
            
            // Assign the winner
            prize.winningTicket = winningTicket.ticketNumber;
            prize.winner = {
                name: winningTicket.name,
                email: winningTicket.email
            };
        }
    }
    
    // Save the updated raffle
    raffle.isDrawn = true;
    raffle.drawnAt = new Date().toISOString();
    writeRaffles(raffles);
    
    res.redirect(`/raffles/${raffle.id}/results`);
});

// Add a route to view raffle results
app.get('/raffles/:id/results', (req, res) => {
    const raffles = readRaffles();
    const raffle = raffles.find(r => r.id === req.params.id);
    
    if (!raffle) {
        return res.status(404).render('error', { 
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }
    
    res.render('raffle-results', { 
        title: `Results - ${raffle.title}`,
        raffle 
    });
});

// Add a route to list all drawn raffles
app.get('/results', (req, res) => {
    const raffles = readRaffles();
    const drawnRaffles = raffles.filter(raffle => raffle.isDrawn);
    
    res.render('all-results', { 
        title: 'Raffle Results',
        raffles: drawnRaffles
    });
});

// Admin dashboard route
app.get('/admin', (req, res) => {
    // Only admins can access this page
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to access the admin dashboard.'
        });
    }

    const raffles = readRaffles();
    
    res.render('admin-dashboard', { 
        title: 'Admin Dashboard',
        raffles: raffles
    });
});

// Route to view raffle ticket holders
app.get('/admin/raffles/:id/tickets', (req, res) => {
    // Only admins can access this page
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to view ticket holders.'
        });
    }

    const raffles = readRaffles();
    const raffle = raffles.find(r => r.id === req.params.id);
    
    if (!raffle) {
        return res.status(404).render('error', { 
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }
    
    res.render('admin-tickets', { 
        title: `Ticket Holders - ${raffle.title}`,
        raffle 
    });
});

// Route to end a raffle immediately
app.post('/admin/raffles/:id/end', (req, res) => {
    // Only admins can end raffles
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to end raffles.'
        });
    }

    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    
    // Set end date to now to force the raffle to end
    raffle.endDate = new Date().toISOString();
    writeRaffles(raffles);
    
    res.redirect('/admin');
});

// Route to remove a prize from a raffle
app.post('/raffles/:id/prizes/remove/:prizeId', (req, res) => {
    // Only admins can remove prizes
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to remove prizes.'
        });
    }

    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    
    // Don't allow removing prizes if the raffle is already drawn
    if (raffle.isDrawn) {
        return res.status(400).render('error', {
            title: 'Cannot Remove Prize',
            message: 'Cannot remove prizes from a raffle that has already been drawn.'
        });
    }
    
    // Find the prize and remove it
    if (raffle.prizes) {
        const prizeIndex = raffle.prizes.findIndex(p => p.id === req.params.prizeId);
        if (prizeIndex !== -1) {
            raffle.prizes.splice(prizeIndex, 1);
            writeRaffles(raffles);
        }
    }
    
    res.redirect(`/raffles/${raffle.id}/prizes`);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', {
        title: 'Error',
        message: 'Something went wrong!'
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 