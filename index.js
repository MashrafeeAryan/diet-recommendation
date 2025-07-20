import { Client, Databases } from "node-appwrite";

// Main Appwrite function handler
export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  const body = JSON.parse(req.body || '{}');
  const { preferences = [], allergies = [], target } = body;

  if (
    !target ||
    typeof target.calories !== 'number' ||
    typeof target.protein !== 'number' ||
    typeof target.carbs !== 'number' ||
    typeof target.fat !== 'number'
  ) {
    return res.json({ error: "Invalid or missing nutrition target" }); // ✅ return added
  }

  try {
    const response = await databases.listDocuments(
      process.env.DatabaseID,
      process.env.foodDatasetID,
      []
    );

    let foods = response.documents;

    foods = foods.filter(food =>
      ['calories', 'protein', 'carbs', 'fat'].every(key =>
        typeof food[key] === 'number' && !isNaN(food[key])
      )
    );

    if (preferences.length > 0) {
      foods = foods.filter(food =>
        preferences.every(tag => food.tags?.includes(tag))
      );
    }

    if (allergies.length > 0) {
      foods = foods.filter(food =>
        !food.ingredients?.some(ing => allergies.includes(ing))
      );
    }

    foods.sort((a, b) => {
      const aDensity = (a.protein || 0) / (a.calories || 1);
      const bDensity = (b.protein || 0) / (b.calories || 1);
      return bDensity - aDensity;
    });

    let plan = [];
    let total = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    for (const food of foods) {
      const nextCalories = total.calories + (food.calories || 0);
      const nextProtein = total.protein + (food.protein || 0);
      const nextCarbs = total.carbs + (food.carbs || 0);
      const nextFat = total.fat + (food.fat || 0);

      if (
        nextCalories <= target.calories &&
        nextProtein <= target.protein &&
        nextCarbs <= target.carbs &&
        nextFat <= target.fat
      ) {
        plan.push(food);
        total.calories = nextCalories;
        total.protein = nextProtein;
        total.carbs = nextCarbs;
        total.fat = nextFat;
      }

      if (total.calories >= target.calories * 0.95) break;
    }

    // ✅ return the response
    return res.json({
      plan,
      totals: total
    });

  } catch (err) {
    console.error(err);
    return res.json({ // ✅ return here too
      error: "Something went wrong",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};
