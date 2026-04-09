(function () {
    const SUPPORTED_AVATAR_IDS = [
        'cat',
        'dog',
        'fox',
        'panda',
        'rabbit',
        'bear',
        'tiger',
        'lion',
        'frog',
        'penguin',
        'owl',
        'koala'
    ];

    const DEFAULT_AVATAR_ID = 'penguin';
    const AVATAR_LABELS = {
        cat: 'Cat',
        dog: 'Dog',
        fox: 'Fox',
        panda: 'Panda',
        rabbit: 'Rabbit',
        bear: 'Bear',
        tiger: 'Tiger',
        lion: 'Lion',
        frog: 'Frog',
        penguin: 'Penguin',
        owl: 'Owl',
        koala: 'Koala'
    };

    const AVATAR_OPTIONS = SUPPORTED_AVATAR_IDS.map((id) => ({
        id,
        label: AVATAR_LABELS[id] || id
    }));

    function normalizeAvatarId(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return SUPPORTED_AVATAR_IDS.includes(normalized) ? normalized : DEFAULT_AVATAR_ID;
    }

    function avatarLabel(value) {
        const normalized = normalizeAvatarId(value);
        return AVATAR_LABELS[normalized] || AVATAR_LABELS[DEFAULT_AVATAR_ID];
    }

    function avatarAssetPath(value) {
        return `/assets/avatars/${normalizeAvatarId(value)}.png`;
    }

    function applyAvatarImage(img, value, altText) {
        if (!img) return;
        const normalized = normalizeAvatarId(value);
        const fallbackSrc = avatarAssetPath(DEFAULT_AVATAR_ID);
        img.alt = altText || `${avatarLabel(normalized)} avatar`;
        img.dataset.avatarId = normalized;
        img.onerror = function handleAvatarError() {
            if (img.dataset.avatarFallbackApplied === '1') return;
            img.dataset.avatarFallbackApplied = '1';
            img.src = fallbackSrc;
        };
        img.dataset.avatarFallbackApplied = normalized === DEFAULT_AVATAR_ID ? '1' : '0';
        img.src = avatarAssetPath(normalized);
    }

    window.AvatarCatalog = {
        SUPPORTED_AVATAR_IDS,
        DEFAULT_AVATAR_ID,
        AVATAR_LABELS,
        AVATAR_OPTIONS,
        normalizeAvatarId,
        avatarLabel,
        avatarAssetPath,
        applyAvatarImage
    };
})();
