struct Player {
    int id;
    char name[16];
    int score;
    float health;
    struct Player *next;
};

int count_alive(struct Player *p) {
    int alive = 0;
    while (p) {
        if (p->health > 0.0f && p->score >= 0)
            alive++;
        p = p->next;
    }
    return alive;
}
