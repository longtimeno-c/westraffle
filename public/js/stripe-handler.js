// Initialize Stripe only if payments are enabled
let stripe;
let elements;

if (ENABLE_PAYMENTS === 'true') {
    stripe = Stripe(STRIPE_PUBLIC_KEY);
}

// Handle bid submission
async function handleBidSubmission(raffleId, bidAmount) {
    try {
        // Get form data
        const form = document.getElementById('bid-form');
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        
        // Submit the form directly instead of using fetch
        form.submit();
    } catch (error) {
        console.error('Error:', error);
        alert('Error processing bid. Please try again.');
    }
}

// Function to close payment modal
function closePaymentModal() {
    if (document.getElementById('payment-modal')) {
        document.getElementById('payment-modal').style.display = 'none';
    }
} 