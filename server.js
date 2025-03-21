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

// Helper function to read auctions
const readAuctions = () => {
    const auctionsPath = path.join(dataDir, 'auctions.json');
    if (fs.existsSync(auctionsPath)) {
        return JSON.parse(fs.readFileSync(auctionsPath, 'utf8'));
    }
    return [];
};

// Helper function to write auctions
const writeAuctions = (auctions) => {
    const auctionsPath = path.join(dataDir, 'auctions.json');
    fs.writeFileSync(auctionsPath, JSON.stringify(auctions, null, 2));
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
const calculateImpactMetrics = (raffles, auctions) => {
    let totalRaised = 0;
    let activeRaffles = 0;
    let activeAuctions = 0;
    let uniqueSupporters = new Set();

    const now = new Date();

    // Calculate metrics from raffles
    raffles.forEach(raffle => {
        totalRaised += (raffle.soldTickets || 0) * raffle.ticketPrice;
        if (raffle.tickets) {
            raffle.tickets.forEach(ticket => {
                uniqueSupporters.add(ticket.email);
            });
        }

        // Check if raffle is active
        const endDate = new Date(raffle.endDate);
        if (!isNaN(endDate.getTime()) && endDate > now) {
            activeRaffles++;
        }
    });

    // Calculate metrics from auctions
    auctions.forEach(auction => {
        if (auction.currentBid > 0) {
            totalRaised += auction.currentBid;
        }
        if (auction.bids) {
            auction.bids.forEach(bid => {
                uniqueSupporters.add(bid.email);
            });
        }

        // Check if auction is active
        const endDate = new Date(auction.endDate);
        if (!isNaN(endDate.getTime()) && endDate > now) {
            activeAuctions++;
        }
    });

    return {
        totalRaised,
        activeRaffles,
        activeAuctions,
        totalActivities: activeRaffles + activeAuctions,
        totalSupporters: uniqueSupporters.size
    };
};

// Routes
app.get('/', (req, res) => {
    const raffles = readRaffles();
    const auctions = readAuctions();
    const metrics = calculateImpactMetrics(raffles, auctions);
    res.render('index', { 
        title: 'West Raffle - Charity Fundraising', 
        raffles,
        auctions,
        metrics 
    });
});

app.get('/raffles', (req, res) => {
    const raffles = readRaffles();
    const auctions = readAuctions();
    const metrics = calculateImpactMetrics(raffles, auctions);
    res.render('raffles', { 
        title: 'Active Raffles', 
        raffles,
        metrics 
    });
});

app.get('/charity', (req, res) => {
    const raffles = readRaffles();
    const auctions = readAuctions();
    const metrics = calculateImpactMetrics(raffles, auctions);
    res.render('charity', { 
        title: 'Our Charity Mission',
        metrics
    });
});

// Separate routes for creating raffles and auctions
app.get('/create-raffle', (req, res) => {
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to create raffles.'
        });
    }
    res.render('create-raffle', { title: 'Create New Raffle' });
});

app.get('/create-auction', (req, res) => {
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to create auctions.'
        });
    }
    res.render('create-auction', { title: 'Create New Auction' });
});

app.post('/create-raffle', upload.single('image'), (req, res) => {
    const raffles = readRaffles();
    const newRaffle = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
        imageUrl: req.file ? `/images/raffles/${req.file.filename}` : null,
        soldTickets: 0,
        tickets: [],
        ticketPrice: parseFloat(req.body.ticketPrice),
        totalTickets: parseInt(req.body.totalTickets),
        prizes: [] // Initialize empty prizes array
    };
    
    raffles.push(newRaffle);
    writeRaffles(raffles);
    
    res.redirect('/raffles');
});

app.post('/create-auction', upload.single('image'), (req, res) => {
    const auctions = readAuctions();
    const newAuction = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
        imageUrl: req.file ? `/images/raffles/${req.file.filename}` : null,
        currentBid: parseFloat(req.body.startingBid) || 0,
        startingBid: parseFloat(req.body.startingBid) || 0,
        minimumBidIncrement: parseFloat(req.body.minimumBidIncrement) || 1,
        bids: [],
        itemCondition: req.body.itemCondition,
        itemValue: parseFloat(req.body.itemValue) || 0,
        donorName: req.body.donorName
    };
    
    auctions.push(newAuction);
    writeAuctions(auctions);
    
    res.redirect('/auctions');
});

// Routes for viewing raffles and auctions
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
        raffle,
        isAuction: false
    });
});

app.get('/auctions/:id', (req, res) => {
    const auctions = readAuctions();
    const auction = auctions.find(a => a.id === req.params.id);
    
    if (!auction) {
        return res.status(404).render('error', { 
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }
    
    res.render('auction-detail', { 
        title: auction.title,
        auction,
        isAuction: true
    });
});

// Routes for purchasing tickets and placing bids
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

// Add a route for auctions
app.get('/auctions', (req, res) => {
    const auctions = readAuctions();
    const raffles = readRaffles();
    const metrics = calculateImpactMetrics(raffles, auctions);
    
    res.render('auctions', { 
        title: 'Active Auctions', 
        auctions,
        metrics 
    });
});

// Add new route for placing bids
app.post('/auctions/:id/bid', (req, res) => {
    const auctions = readAuctions();
    const auctionIndex = auctions.findIndex(a => a.id === req.params.id);
    
    if (auctionIndex === -1) {
        return res.status(404).render('error', {
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }

    const auction = auctions[auctionIndex];
    
    // Check if auction has ended
    const now = new Date();
    const endDate = new Date(auction.endDate);
    if (endDate <= now) {
        return res.status(400).render('error', {
            title: 'Auction Ended',
            message: 'This auction has already ended.'
        });
    }

    const bidAmount = parseFloat(req.body.bidAmount);
    const minimumBid = auction.currentBid + (auction.minimumBidIncrement || 1);
    
    if (bidAmount < minimumBid) {
        return res.status(400).render('error', {
            title: 'Invalid Bid',
            message: `Your bid must be at least $${minimumBid.toFixed(2)}.`
        });
    }

    // Add the bid
    auction.bids.push({
        id: Date.now().toString(),
        amount: bidAmount,
        name: req.body.name,
        email: req.body.email,
        timestamp: new Date().toISOString()
    });

    auction.currentBid = bidAmount;
    writeAuctions(auctions);

    res.redirect(`/auctions/${auction.id}?success=true`);
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
    const auctions = readAuctions();
    
    res.render('admin-dashboard', { 
        title: 'Admin Dashboard',
        raffles,
        auctions
    });
});

// Route to end an auction immediately
app.post('/admin/auctions/:id/end', (req, res) => {
    // Only admins can end auctions
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to end auctions.'
        });
    }

    const auctions = readAuctions();
    const auctionIndex = auctions.findIndex(a => a.id === req.params.id);
    
    if (auctionIndex === -1) {
        return res.status(404).render('error', {
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }

    const auction = auctions[auctionIndex];
    
    // Set end date to now to force the auction to end
    auction.endDate = new Date().toISOString();
    writeAuctions(auctions);
    
    res.redirect('/admin');
});

// Route to view auction bids
app.get('/admin/auctions/:id/bids', (req, res) => {
    // Only admins can access this page
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to view bids.'
        });
    }

    const auctions = readAuctions();
    const auction = auctions.find(a => a.id === req.params.id);
    
    if (!auction) {
        return res.status(404).render('error', { 
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }
    
    res.render('admin-bids', { 
        title: `Bids - ${auction.title}`,
        auction 
    });
});

// Add a route for completing an auction
app.post('/auctions/:id/complete', (req, res) => {
    // Only admins can complete auctions
    if (req.cookies.username !== process.env.ADMIN_USERNAME) {
        return res.status(403).render('error', {
            title: 'Access Denied',
            message: 'You do not have permission to complete auctions.'
        });
    }

    const auctions = readAuctions();
    const auctionIndex = auctions.findIndex(a => a.id === req.params.id);
    
    if (auctionIndex === -1) {
        return res.status(404).render('error', {
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }

    const auction = auctions[auctionIndex];
    
    // Check if the auction has bids
    if (!auction.bids || auction.bids.length === 0) {
        return res.status(400).render('error', {
            title: 'Cannot Complete Auction',
            message: 'This auction has no bids.'
        });
    }
    
    // Check if the auction end date has passed
    const now = new Date();
    const endDate = new Date(auction.endDate);
    if (endDate > now) {
        return res.status(400).render('error', {
            title: 'Cannot Complete Auction',
            message: 'This auction has not ended yet.'
        });
    }
    
    // Find winning bid (should be the highest amount)
    const winningBid = auction.bids.reduce((highest, bid) => {
        return bid.amount > highest.amount ? bid : highest;
    }, { amount: 0 });
    
    // Set the auction as completed with winner info
    auction.isCompleted = true;
    auction.completedAt = new Date().toISOString();
    auction.winner = {
        name: winningBid.name,
        email: winningBid.email,
        bid: winningBid.amount
    };
    
    writeAuctions(auctions);
    
    res.redirect(`/auctions/${auction.id}/results`);
});

// Route to view auction results
app.get('/auctions/:id/results', (req, res) => {
    const auctions = readAuctions();
    const auction = auctions.find(a => a.id === req.params.id);
    
    if (!auction) {
        return res.status(404).render('error', { 
            title: 'Auction Not Found',
            message: 'The requested auction could not be found.'
        });
    }
    
    res.render('auction-results', { 
        title: `Results - ${auction.title}`,
        auction 
    });
});

// Add a route for the combined results page
app.get('/results', (req, res) => {
    const raffles = readRaffles();
    const auctions = readAuctions();
    
    // Filter completed raffles and auctions
    const completedRaffles = raffles.filter(raffle => raffle.isDrawn);
    const completedAuctions = auctions.filter(auction => auction.isCompleted);
    
    const metrics = calculateImpactMetrics(raffles, auctions);
    
    res.render('results', {
        title: 'Results - Raffles and Auctions',
        completedRaffles,
        completedAuctions,
        metrics
    });
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