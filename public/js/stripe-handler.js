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
        
        // Create payment intent for the bid
        const response = await fetch('/create-bid-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: bidAmount,
                raffleId: raffleId
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        // Create and mount the payment element
        const appearance = {
            theme: 'stripe',
            variables: {
                colorPrimary: '#4f46e5',
                colorBackground: '#ffffff',
                colorText: '#1f2937',
                colorDanger: '#ef4444',
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                spacingUnit: '4px',
                borderRadius: '8px',
            },
        };

        elements = stripe.elements({ appearance, clientSecret: data.clientSecret });
        const paymentElement = elements.create('payment', {
            layout: {
                type: 'accordion',
                defaultCollapsed: false,
                radios: true,
                spacedAccordionItems: true
            },
            paymentMethodOrder: ['apple_pay', 'google_pay', 'card'],
            wallets: {
                applePay: 'auto',
                googlePay: 'auto'
            }
        });

        // Show payment modal
        const modal = document.getElementById('payment-modal');
        const paymentContainer = document.getElementById('payment-element');
        paymentContainer.innerHTML = '';
        paymentElement.mount('#payment-element');
        modal.style.display = 'block';

        // Handle form submission
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            
            const submitButton = document.getElementById('submit-button');
            const spinner = document.getElementById('spinner');
            const buttonText = document.getElementById('button-text');
            const errorMessage = document.getElementById('error-message');

            // Disable form submission while processing
            submitButton.disabled = true;
            spinner.classList.remove('hidden');
            buttonText.classList.add('opacity-0');
            errorMessage.classList.add('hidden');

            try {
                const { error } = await stripe.confirmPayment({
                    elements,
                    confirmParams: {
                        return_url: window.location.origin + '/raffles/' + raffleId + '?success=true',
                    },
                });

                if (error) {
                    errorMessage.textContent = error.message;
                    errorMessage.classList.remove('hidden');
                    submitButton.disabled = false;
                    spinner.classList.add('hidden');
                    buttonText.classList.remove('opacity-0');
                }
            } catch (error) {
                console.error('Payment failed:', error);
                errorMessage.textContent = 'An unexpected error occurred. Please try again.';
                errorMessage.classList.remove('hidden');
                submitButton.disabled = false;
                spinner.classList.add('hidden');
                buttonText.classList.remove('opacity-0');
            }
        });
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