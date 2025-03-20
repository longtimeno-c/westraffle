const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser');
const multer = require('multer');
require('dotenv').config();

// Initialize Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

// Add this middleware to make environment variables available to all views
app.use((req, res, next) => {
    // Only set Stripe variables if they haven't been set yet
    if (!res.locals.STRIPE_PUBLIC_KEY) {
        // Validate required environment variables
        if (!process.env.STRIPE_PUBLIC_KEY) {
            console.error('STRIPE_PUBLIC_KEY is not set in environment variables');
        }
        if (!process.env.STRIPE_SECRET_KEY) {
            console.error('STRIPE_SECRET_KEY is not set in environment variables');
        }
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
            console.error('STRIPE_WEBHOOK_SECRET is not set in environment variables');
        }

        res.locals.STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY;
        res.locals.ENABLE_PAYMENTS = process.env.ENABLE_PAYMENTS;
        
        // Only log for payment-related routes
        if (req.path.includes('/payment') || req.path.includes('/bid') || req.path.includes('/purchase')) {
            console.log('Setting up Stripe environment variables:', {
                hasPublicKey: !!process.env.STRIPE_PUBLIC_KEY,
                hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
                hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
                enablePayments: process.env.ENABLE_PAYMENTS,
                path: req.path,
                protocol: req.protocol,
                host: req.get('host')
            });
        }
    }
    next();
});

// Add HTTPS redirect middleware
app.use((req, res, next) => {
    if (process.env.ENABLE_PAYMENTS === 'true' && !req.secure && req.get('x-forwarded-proto') !== 'https' && process.env.NODE_ENV !== 'development') {
        return res.redirect('https://' + req.get('host') + req.url);
    }
    next();
});

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

app.post('/raffles/:id/purchase', async (req, res) => {
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

    // Calculate total amount
    const amount = quantity * raffle.ticketPrice;

    try {
        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'usd',
            metadata: {
                raffleId: raffle.id,
                quantity: quantity,
                type: 'ticket_purchase'
            },
            receipt_email: req.body.email,
            shipping: {
                name: req.body.name
            },
            automatic_payment_methods: {
                enabled: true,
            }
        });

        // Render payment page with client secret
        res.render('payment', {
            title: 'Purchase Tickets',
            clientSecret: paymentIntent.client_secret,
            amount: amount,
            quantity: quantity,
            raffle: raffle,
            STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
            ENABLE_PAYMENTS: process.env.ENABLE_PAYMENTS
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).render('error', {
            title: 'Payment Error',
            message: 'There was an error processing your payment. Please try again.'
        });
    }
});

// Create a payment intent for ticket purchase
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount, raffleId, quantity } = req.body;
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
                raffleId,
                quantity,
                type: 'ticket_purchase'
            },
            automatic_payment_methods: {
                enabled: true,
            }
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create a payment intent for auction bid
app.post('/create-bid-payment-intent', async (req, res) => {
    try {
        const { amount, raffleId } = req.body;
        
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
                raffleId,
                type: 'auction_bid'
            }
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating bid payment intent:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook handler for Stripe events
app.post('/webhook', bodyParser.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    console.log('Received Stripe webhook:', {
        signature: sig ? 'Present' : 'Missing',
        eventType: req.body.type
    });

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log('Webhook event constructed successfully:', {
            type: event.type,
            id: event.id,
            created: event.created
        });
    } catch (err) {
        console.error('Webhook Error:', {
            message: err.message,
            type: err.type,
            stack: err.stack
        });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle successful payments
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const metadata = paymentIntent.metadata;
        console.log('Processing successful payment:', {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            metadata: metadata
        });

        const raffles = readRaffles();
        const raffleIndex = raffles.findIndex(r => r.id === metadata.raffleId);
        
        if (raffleIndex === -1) {
            console.error('Raffle not found for payment:', {
                raffleId: metadata.raffleId,
                paymentIntentId: paymentIntent.id
            });
            return res.status(400).send('Raffle not found');
        }

        const raffle = raffles[raffleIndex];
        console.log('Found raffle for payment:', {
            raffleId: raffle.id,
            type: raffle.raffleType,
            currentBid: raffle.currentBid
        });

        if (metadata.type === 'ticket_purchase') {
            // Add purchased tickets
            const quantity = parseInt(metadata.quantity);
            console.log('Processing ticket purchase:', {
                quantity,
                paymentIntentId: paymentIntent.id
            });
            for (let i = 0; i < quantity; i++) {
                raffle.tickets.push({
                    id: Date.now().toString() + i,
                    name: paymentIntent.shipping?.name || 'Anonymous',
                    email: paymentIntent.receipt_email || 'anonymous@example.com',
                    purchaseDate: new Date().toISOString(),
                    paymentIntentId: paymentIntent.id
                });
            }
            raffle.soldTickets += quantity;
        } else if (metadata.type === 'auction_bid') {
            // Add new bid
            const bidAmount = paymentIntent.amount / 100;
            console.log('Processing auction bid:', {
                bidAmount,
                paymentIntentId: paymentIntent.id
            });
            raffle.bids.push({
                amount: bidAmount,
                name: paymentIntent.shipping?.name || 'Anonymous',
                email: paymentIntent.receipt_email || 'anonymous@example.com',
                timestamp: new Date().toISOString(),
                paymentIntentId: paymentIntent.id
            });
            raffle.currentBid = bidAmount;
        }

        writeRaffles(raffles);
        console.log('Successfully processed payment and updated raffle');
    }

    res.json({received: true});
});

// Update the payment page render in the bid route
app.post('/raffles/:id/bid', async (req, res) => {
    try {
        const raffles = readRaffles();
        const raffleIndex = raffles.findIndex(r => r.id === req.params.id);
        
        if (raffleIndex === -1) {
            console.error('Raffle not found:', req.params.id);
            return res.status(404).render('error', {
                title: 'Raffle Not Found',
                message: 'The requested raffle could not be found.'
            });
        }

        const raffle = raffles[raffleIndex];
        
        if (raffle.raffleType !== 'auction') {
            console.error('Invalid raffle type for bid:', raffle.raffleType);
            return res.status(400).render('error', {
                title: 'Invalid Operation',
                message: 'This raffle does not accept bids.'
            });
        }

        const bidAmount = parseFloat(req.body.bidAmount);
        const minimumBid = raffle.currentBid + raffle.minimumBidIncrement;
        
        if (bidAmount < minimumBid) {
            console.error('Invalid bid amount:', {
                bidAmount,
                minimumBid,
                currentBid: raffle.currentBid,
                increment: raffle.minimumBidIncrement
            });
            return res.status(400).render('error', {
                title: 'Invalid Bid',
                message: `Bid must be at least $${minimumBid}`
            });
        }

        // Create a payment intent for the bid
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(bidAmount * 100),
            currency: 'usd',
            metadata: {
                raffleId: raffle.id,
                type: 'auction_bid'
            },
            receipt_email: req.body.email,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            }
        });

        console.log('Payment intent created:', {
            id: paymentIntent.id,
            amount: paymentIntent.amount,
            status: paymentIntent.status,
            clientSecret: paymentIntent.client_secret ? 'Present' : 'Missing'
        });

        // Render payment page with client secret
        res.render('payment', {
            title: 'Place Bid',
            clientSecret: paymentIntent.client_secret,
            amount: bidAmount,
            raffle: raffle,
            isBid: true,
            name: req.body.name || '',
            email: req.body.email || '',
            STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
            ENABLE_PAYMENTS: process.env.ENABLE_PAYMENTS
        });
    } catch (error) {
        console.error('Error processing bid:', {
            message: error.message,
            type: error.type,
            code: error.code,
            stack: error.stack
        });
        res.status(500).render('error', {
            title: 'Bid Error',
            message: 'There was an error processing your bid. Please try again.'
        });
    }
});

// Add a GET route for bid confirmation
app.get('/raffles/:id/bid', (req, res) => {
    try {
        const raffles = readRaffles();
        const raffle = raffles.find(r => r.id === req.params.id);
        
        if (!raffle) {
            return res.status(404).render('error', {
                title: 'Raffle Not Found',
                message: 'The requested raffle could not be found.'
            });
        }
        
        // Redirect to the raffle page if GET request is made directly
        res.redirect(`/raffles/${req.params.id}`);
    } catch (error) {
        console.error('Error processing bid page:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'There was an error processing your request. Please try again.'
        });
    }
});

// Add route to handle raffle completion
app.post('/raffles/:id/complete', async (req, res) => {
    try {
        const raffles = readRaffles();
        const raffle = raffles.find(r => r.id === req.params.id);
        
        if (!raffle) {
            return res.status(404).json({ error: 'Raffle not found' });
        }

        // Find winning bid
        const winningBid = raffle.bids.reduce((prev, current) => 
            (prev.amount > current.amount) ? prev : current
        , raffle.bids[0]);

        if (process.env.ENABLE_PAYMENTS === 'true') {
            // Process payments only if payment system is enabled
            for (const bid of raffle.bids) {
                if (bid.paymentIntentId) {
                    try {
                        if (bid === winningBid) {
                            // Capture payment for winning bid
                            await stripe.paymentIntents.capture(bid.paymentIntentId);
                        } else {
                            // Cancel payment intent for losing bids
                            await stripe.paymentIntents.cancel(bid.paymentIntentId);
                        }
                    } catch (error) {
                        console.error('Error processing payment for bid:', error);
                    }
                }
            }
        }

        // Update raffle status
        raffle.completed = true;
        raffle.winner = winningBid.bidder;
        writeRaffles(raffles);

        res.json({ success: true, winner: winningBid.bidder });
    } catch (error) {
        console.error('Error completing raffle:', error);
        res.status(500).json({ error: 'Error completing raffle' });
    }
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