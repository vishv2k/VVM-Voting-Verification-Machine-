const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const { getMaxListeners } = require("nodemailer/lib/xoauth2");
require("dotenv").config();

const app = express();
const port = 3001;

mongoose
  .connect("mongodb://127.0.0.1:27017/VVMDB")
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const DummyAadharSchema = new mongoose.Schema({
  aadharNo: { type: String, required: true },
  isMinor: { type: Boolean, required: true },
});

const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 }, 
});

const RegistereduserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  aadharNo: { type: String, required: true, unique: true },
  accountAddress: { type: String, required: true, unique: true, lowercase: true }, // Fixed syntax
  isVerified: { type: Boolean, default: false },
  hasVoted: { type: Boolean, default: false }, 
  createdAt: { type: Date, default: Date.now },
});

const candidateSchema = new mongoose.Schema({
  name: String,
  party: String,
  age: Number,
  qualification: String,
  votes: { type: Number, default: 0 }
});

const VotingSchema = new mongoose.Schema({
  aadharNo: String,
  accountAddress: String,
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", required: true },
  timestamp: { type: Date, default: Date.now },
});

const phaseSchema = new mongoose.Schema({
  currentPhase: { type: String, required: true, enum: ["registration", "voting", "result"], default: "registration" }
});

const User = mongoose.model("User", UserSchema);
const DummyAadhar = mongoose.model("DummyAadhar", DummyAadharSchema);
const Otp = mongoose.model("Otp", OtpSchema);
const Registereduser = mongoose.model("RegisterUser", RegistereduserSchema);
const Candidate = mongoose.model('Candidate', candidateSchema);
const Voting = mongoose.model("Voting", VotingSchema);
const Phase = mongoose.model("Phase", phaseSchema);


app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


DummyAadhar.insertMany([
  { aadharNo: "454545565656", isMinor: false },
  { aadharNo: "232323343434", isMinor: false },
  { aadharNo: "656565676565", isMinor: false },
  { aadharNo: "727278727972", isMinor: true },
  { aadharNo: "828485828281", isMinor: true },
]);


const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "votingverficationmachine@gmail.com",
    pass: "wsrt youa kxjv omet",
  },
  debug: true,
  logger: true, 
});


app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use. Please log in." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword });

    await newUser.save();
    res.status(201).json({ message: "User registered successfully." });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "An error occurred while registering the user." });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please enter both email and password." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found. Please sign up." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid password. Please try again." });
    }

    res.status(200).json({ message: "Login successful." });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "An error occurred during login." });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { aadharNo, accountAddress, email } = req.body;

    const aadhar = await DummyAadhar.findOne({ aadharNo });
    if (!aadhar) return res.status(400).json({ message: "Invalid Aadhar Number" });

    if (aadhar.isMinor) {
      return res.status(200).json({ redirect: "checkage.html" }); // This redirects to the checkage.html page
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(accountAddress)) {
      return res.status(400).json({ message: "Invalid Metamask Address" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const existingUser = await Registereduser.findOne({
      $or: [{ aadharNo }],
    });
    if (existingUser) {
      return res.status(400).json({
        message: "Aadhar number is already registered.",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    const mailOptions = {
      from: "rjragavendran@gmail.com",
      to: email,
      subject: "OTP Verification",
      text: `Your OTP for voter registration is: ${otp}`,
    };

    await transporter.sendMail(mailOptions);

    const otpEntry = new Otp({ email, otp });
    await otpEntry.save();

    const registerUser = new Registereduser({
      email,
      aadharNo,
      accountAddress,
    });

    await registerUser.save();

    res.status(200).json({ message: "OTP sent. Please verify.", redirect: "emailverify.html" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "An error occurred during registration." });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const otpRecord = await Otp.findOne({ email });
  if (!otpRecord) {
    return res.status(400).json({ message: "Invalid email or OTP expired." });
  }

  if (otpRecord.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP." });
  }

  await Registereduser.updateOne({ email }, { isVerified: true });

  return res.status(200).json({ success: true, message: "User registered successfully." });
});

app.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const newOtp = Math.floor(100000 + Math.random() * 900000);

    await Otp.findOneAndUpdate(
      { email },
      { otp: newOtp, createdAt: Date.now() },
      { upsert: true }
    );

    const mailOptions = {
      from: 'rjragavendran@gmail.com',
      to: email,
      subject: 'New OTP for Verification',
      text: `Your new OTP is: ${newOtp}. It is valid for 1 minute.`,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: 'OTP resent successfully.' });
  } catch (error) {
    console.error('Error in resending OTP:', error);
    res.status(500).json({ message: 'Error in resending OTP.' });
  }
});

app.post("/adlogin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    if (!admin || admin.password !== password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    res.status(200).json({ message: "Login successful. Please enter your PIN." });
  } catch (error) {
    console.error("Error during admin login:", error);
    res.status(500).json({ message: "An error occurred during admin login." });
  }
});

app.get("/getRegisteredUsers", async (req, res) => {
  try {
    const registeredUsers = await Registereduser.find({});
    res.status(200).json(registeredUsers);
  } catch (error) {
    console.error("Error fetching registered users:", error);
    res.status(500).json({ message: "Error fetching registered users" });
  }
});

app.post('/addCandidate', async (req, res) => {
  const { name, party, age, qualification } = req.body;

  if (age <= 18) {
    return res.status(400).json({ message: "Age must be above 18 to add a candidate!" });
  }

  const newCandidate = new Candidate({ name, party, age, qualification });

  try {
    await newCandidate.save();
    res.status(201).json({ message: "Candidate added successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error adding candidate", error: err });
  }
});

app.get('/getCandidates', async (req, res) => {
  try {
    const candidates = await Candidate.find();
    res.status(200).json(candidates);
  } catch (err) {
    res.status(500).json({ message: "Error fetching candidates", error: err });
  }
});

app.get("/api/candidate", async (req, res) => {
  try {
      const candidates = await Candidate.find();
      res.json(candidates);
  } catch (error) {
      res.status(500).json({ message: "Error fetching candidates", error });
  }
});

app.post("/api/checkIsMinor", async (req, res) => {
  try {
    const { aadharNo } = req.body;

    if (!aadharNo) {
      return res.status(400).json({ message: "Aadhar number is required." });
    }

    const aadharRecord = await DummyAadhar.findOne({ aadharNo });

    if (!aadharRecord) {
      return res.status(404).json({ message: "Aadhar number not found." });
    }

    if (aadharRecord.isMinor) {
      return res.json({ isMinor: true, message: "User is a minor and not eligible to vote!" });
    } else {
      return res.json({ isMinor: false, message: "User is eligible to vote." });
    }
  } catch (error) {
    console.error("Error checking minor status:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.post("/api/validateUser", async (req, res) => {
  try {
    const { aadharNo, accountAddress, candidateId } = req.body;
    const normalizedAccountAddress = accountAddress.toLowerCase();

    let user = await Registereduser.findOne({ aadharNo, accountAddress: normalizedAccountAddress });
    if (!user) return res.json({ success: false, message: "User not found!" });
    if (user.hasVoted) return res.json({ success: false, message: "User has already voted!" });

    await Candidate.findByIdAndUpdate(candidateId, { $inc: { votes: 1 } });
    user.hasVoted = true;
    await user.save();

    const newVote = new Voting({ aadharNo, accountAddress: normalizedAccountAddress, candidateId });
    await newVote.save();

    res.json({ success: true, message: "Vote successfully submitted!" });
  } catch (error) {
    console.error("Error casting vote:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.get("/api/currentPhase", async (req, res) => {
  try {
    let phase = await Phase.findOne();
    if (!phase) {
      phase = await Phase.create({ currentPhase: "registration" }); // Default phase
    }
    res.json({ phase: phase.currentPhase });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.post("/api/updatePhase", async (req, res) => {
  try {
    const { newPhase } = req.body;

    if (!["registration", "voting", "result"].includes(newPhase)) {
      return res.status(400).json({ error: "Invalid phase value" });
    }

    let phase = await Phase.findOne();
    if (!phase) {
      phase = new Phase({ currentPhase: newPhase });
    } else {
      phase.currentPhase = newPhase;
    }

    await phase.save();
    res.json({ message: "Phase updated successfully!", phase: phase.currentPhase });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

app.get("/resultcandidates", async (req, res) => {
  try {
    const candidates = await Candidate.find().sort({ votes: -1 });
    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: "Error fetching results" });
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
