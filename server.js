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
        if (raffle.raffleType === 'tickets') {
            totalRaised += (raffle.soldTickets || 0) * raffle.ticketPrice;
            if (raffle.tickets) {
                raffle.tickets.forEach(ticket => {
                    uniqueSupporters.add(ticket.email);
                });
            }
        } else {
            if (raffle.currentBid > 0) {
                totalRaised += raffle.currentBid;
            }
            if (raffle.bids) {
                raffle.bids.forEach(bid => {
                    uniqueSupporters.add(bid.email);
                });
            }
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

    if (req.body.raffleType === 'tickets') {
        newRaffle.soldTickets = 0;
        newRaffle.tickets = [];
        newRaffle.ticketPrice = parseFloat(req.body.ticketPrice);
        newRaffle.totalTickets = parseInt(req.body.totalTickets);
    } else {
        newRaffle.currentBid = parseFloat(req.body.startingBid);
        newRaffle.minimumBidIncrement = parseFloat(req.body.minimumBidIncrement);
        newRaffle.bids = [];
        newRaffle.itemCondition = req.body.itemCondition;
        newRaffle.itemValue = parseFloat(req.body.itemValue);
        newRaffle.donorName = req.body.donorName;
    }
    
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
    for (let i = 0; i < quantity; i++) {
        raffle.tickets.push({
            id: Date.now().toString() + i,
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

// Add new route for placing bids
app.post('/raffles/:id/bid', (req, res) => {
    const raffles = readRaffles();
    const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
    
    if (raffleIndex === -1) {
        return res.status(404).render('error', {
            title: 'Raffle Not Found',
            message: 'The requested raffle could not be found.'
        });
    }

    const raffle = raffles[raffleIndex];
    
    if (raffle.raffleType !== 'auction') {
        return res.status(400).render('error', {
            title: 'Invalid Operation',
            message: 'This raffle does not accept bids.'
        });
    }

    const bidAmount = parseFloat(req.body.bidAmount);
    const minimumBid = raffle.currentBid + raffle.minimumBidIncrement;
    
    if (bidAmount < minimumBid) {
        return res.status(400).render('error', {
            title: 'Invalid Bid',
            message: `Your bid must be at least $${minimumBid.toFixed(2)} higher than the current bid.`
        });
    }

    // Add the bid
    raffle.bids.push({
        id: Date.now().toString(),
        amount: bidAmount,
        name: req.body.name,
        email: req.body.email,
        timestamp: new Date().toISOString()
    });

    raffle.currentBid = bidAmount;
    writeRaffles(raffles);

    res.redirect(`/raffles/${raffle.id}?success=true`);
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