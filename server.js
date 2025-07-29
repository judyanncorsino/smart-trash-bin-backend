const express = require('express')
const admin = require('firebase-admin')
const cors = require('cors')
const { body, validationResult } = require('express-validator')

const serviceAccount = require('./serviceAccountKey.json')

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
})

const db = admin.firestore()
const app = express()
const port = 3000

app.use(cors())
app.use(express.json())

// Validate incoming request data using express-validator
const validateData = [
    body('BinId').isString().withMessage('BinId should be a string'),
    body('Distance').isFloat().withMessage('Distance should be a valid float'),
    body('Token').isString().withMessage('Token should be a string'),
]

app.post('/api/bin', validateData, async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }

    const { BinId, Distance, Token } = req.body
    console.log(req.body)

    try {
        // Query to find the bin document by BinId field (not document ID)
        const binQuery = db.collection('bins').where('BinId', '==', BinId)
        const binSnapshot = await binQuery.get()

        if (binSnapshot.empty) {
            console.log({ message: 'Bin not registered.' })
            return res.status(404).json({ message: 'Bin not registered.' })
        }

        // Assuming there is only one matching bin
        const binData = binSnapshot.docs[0].data()

        // Validate token
        if (binData.Token !== Token) {
            console.log({ message: 'Invalid token. Unauthorized.' })
            return res.status(403).json({ message: 'Invalid token. Unauthorized.' })
        }

        // Calculate fill level percentage
        const fillLevelPercentage = calculateFillLevel(
            binData.FillableHeight, // Actual fillable height of the bin
            Distance, // Distance measured by the sensor
            binData.BufferHeight // Buffer zone that should be ignored
        )

        // Save fill level to Firestore with additional information
        const fillLevelRef = await db.collection('fill_levels').add({
            BinId,
            FillLevelPercentage: fillLevelPercentage,
            Timestamp: admin.firestore.FieldValue.serverTimestamp(), // Use Firestore's timestamp
        })

        // Get the Timestamp from the newly added document
        const fillLevelDoc = await fillLevelRef.get()
        const fillLevelTimestamp = fillLevelDoc.data().Timestamp

        // Update the bin's fill level with the calculated percentage and set the lastUpdated timestamp to the fill_level timestamp
        await db.collection('bins').doc(binSnapshot.docs[0].id).update({
            FillLevelPercentage: fillLevelPercentage, // Update the Fill_Level field in the bins collection
            LastUpdated: fillLevelTimestamp, // Use the timestamp from the fill_level document to update lastUpdated
        })

        console.log({
            message: 'Distance and fill level saved.',
            BinId: binData.BinId,
            FillLevelPercentage: fillLevelPercentage,
        })

        res.status(200).json({
            message: 'Distance and fill level saved.',
            BinId: binData.BinId,
            FillLevelPercentage: fillLevelPercentage,
        })
    } catch (err) {
        console.error('Error verifying token or saving data:', err)
        res.status(500).json({ message: 'Internal server error' })
    }
})

// Function to calculate fill level as a percentage
function calculateFillLevel(fillableHeight, sensorDistance, bufferHeight) {
    if (fillableHeight <= 0 || sensorDistance < 0 || bufferHeight < 0) {
        throw new Error('Invalid height, distance, or buffer values')
    }

    // Calculate the actual fill height by subtracting the buffer height from the sensor distance
    const actualFillHeight = sensorDistance - bufferHeight

    // Calculate the fill level percentage
    const fillLevelPercentage = ((fillableHeight - actualFillHeight) / fillableHeight) * 100

    // Ensure the value stays within 0 to 100 range
    return Math.max(0, Math.min(100, fillLevelPercentage))
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
})
