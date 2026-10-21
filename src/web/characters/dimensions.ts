/*
 * Quote condivise personaggio/sedia (unità mondo, origine ai piedi).
 * Proporzioni chibi: lo stinco (0.22) è troppo corto per una seduta a misura di scrivania (piano a 0.72),
 * quindi la seduta è bassa (0.25, testa sopra il piano) e da seduto lo stinco si allunga di SEATED_SHIN_SCALE.
 */
export const THIGH_LENGTH = 0.2;
/** Ginocchio → suola (stinco + scarpa), in piedi. */
export const SHIN_LENGTH = 0.22;
/** Spessore verticale della coscia quando è orizzontale (profondità della geometria coscia). */
export const THIGH_THICKNESS = 0.17;
export const HIP_Y = THIGH_LENGTH + SHIN_LENGTH;

/** Quota del piano della seduta della sedia. */
export const SEAT_HEIGHT = 0.25;
/** Da seduto l'asse dell'anca sta a metà spessore coscia sopra la seduta. */
export const SEATED_HIP_Y = SEAT_HEIGHT + THIGH_THICKNESS / 2;
/** Allungamento verticale dello stinco da seduto, così la suola tocca il pavimento. */
export const SEATED_SHIN_SCALE = SEATED_HIP_Y / SHIN_LENGTH;
