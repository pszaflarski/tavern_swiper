import random
import itertools
import json

# Configuration
races = ["Elf", "Orc", "Human"]
genders = ["male", "female"]
classes = ["wizard", "warrior", "ranger"]
hair_styles = ["long, wet", "short, messy", "tightly braided", "buzz cut", "high ponytail"]

# Gender-specific modifiers to counteract training bias
# These force the model to acknowledge the gender before processing the shared descriptors
gender_modifiers = {
    "male": "masculine features, strong jawline, athletic build,",
    "female": "feminine features, delicate facial structure, graceful posture,"
}

environments = {
    "Forest": "a blurred background of a serene blue lake and pine trees",
    "Urban_Night": "a blurred background of a bustling city street at night with neon lights",
    "Bathroom_Selfie": "a mirror selfie in a tiled, modern bathroom",
    "Gym_Selfie": "a mirror selfie in a high-end gym, with blurred workout equipment"
}

def generate_prompts():
    prompts = []
    # Cartesian product of all variables
    for race, gender, char_class, hair, (env_name, env_desc) in itertools.product(
        races, genders, classes, hair_styles, environments.items()
    ):
        # We explicitly inject the gender_modifier at the start of the description
        modifier = gender_modifiers[gender]
        
        prompt = (
            f"Description: A {gender} {race} {char_class} with {hair} hair. {modifier} "
            f"Attire: A simple, high-quality, form-fitting {char_class} outfit. "
            f"Environment: {env_desc}. shot on iphone. "
            f"Lighting: Bright, direct midday sun, creating sharp shadows and highlighting skin texture."
        )
        prompts.append(prompt)
    random.shuffle(prompts)
    return prompts

# Execution
if __name__ == "__main__":
    all_prompts = generate_prompts()
    print(json.dumps(all_prompts, indent=2))
