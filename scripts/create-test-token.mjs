import { SignJWT } from "jose";

const JWT_SECRET = "6753bff3b917e375d2fcd7e1bd8cbb5b5416aaf5356238021326c4cae1719bf1e4ec8673144c4be387239760e4ca626b";
const secretKey = new TextEncoder().encode(JWT_SECRET);

async function createToken() {
  const token = await new SignJWT({
    email: "test-ceo@example.com",
    fullName: "Test CEO",
    role: "CEO",
    departmentId: null,
    departmentName: null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("22548a97-9f17-4a60-9305-b4b586398ae2")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey);

  console.log("🔐 JWT Token:");
  console.log(token);
  console.log("\n📝 Use in curl with header:");
  console.log(`-H "Cookie: gani_kpi_session=${token}"`);
}

createToken().catch(console.error);
