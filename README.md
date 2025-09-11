Edge-Based E-Voting System with Multi-Party Computation (MPC)
This project, "Edge-Based E-Voting System with Multi-Party Computation (MPC): A Privacy-Preserving Framework for Sri Lanka," is a research prototype developed to address the challenges of traditional, paper-based voting systems. It leverages Edge Computing and Multi-Party Computation (MPC) to create a secure, efficient, and privacy-preserving e-voting framework suitable for environments with limited infrastructure.

The system is comprised of a FastAPI backend and a Remix frontend, designed to work with an ESP32 or Raspberry Pi as an edge device. The core objective is to ensure the Confidentiality, Integrity, Availability, Authentication, and Non-repudiation (CIAAN) of the electoral process while building public trust in digital voting.

Features
Edge Computing Architecture: Voter authentication and initial vote processing are handled locally on edge devices to minimize network latency and bandwidth usage.

Multi-Party Computation (MPC): MPC protocols are used to securely aggregate votes. This technique ensures that no single entity can access or manipulate the vote data, preserving voter anonymity and guaranteeing a verifiable tally.

Biometric Authentication: Integration with a fingerprint scanner for secure voter verification.

Microservices Design: The system is built with a modular architecture for scalability and maintainability.

Backend Setup & Run
The backend API is built with Python and the FastAPI framework.

cd e-vote-backend
# Install dependencies
pip install -r requirements.txt
# Run the backend server
uvicorn main:app --reload --host 0.0.0.0 --port 8000

Frontend Setup & Run
The frontend is a modern web application built with the Remix framework.

# Change directory to the frontend folder
cd e-vote-frontend 
# Install dependencies
npm install
# Run the development server
npm run dev

Deployment
To prepare the application for a production environment, you must first build the app.

npm run build

Then, the built app can be run in production mode:

npm start

For self-hosting, the built-in Remix app server is production-ready. Make sure to deploy the output from the build process, which includes the build/server and build/client directories.

Styling
This template is configured to use Tailwind CSS for a streamlined styling experience. You are free to use any other CSS framework or custom styling methods.

License
This project is licensed under the MIT License.
