import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { prisma } from '../prismaClient.js'

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: {
            name: profile.displayName,
            avatar: profile.photos?.[0]?.value,
          },
          create: { 
            googleId: profile.id,
            email: profile.emails![0].value,
            name: profile.displayName,
            avatar: profile.photos?.[0]?.value,
          },
        })
        done(null, user)
      } catch (err) {
        done(err as Error)
      }
    }
  )
)

passport.serializeUser((user: any, done) => done(null, user.id))

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } })
    done(null, user)
  } catch (err) {   
    done(err as Error)
  }
})
